use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc};
use tokio::sync::RwLock;
use std::collections::HashMap;
use starknet::core::types::Felt as FieldElement;
use tower_http::cors::{Any, CorsLayer};
use light_poseidon::{Poseidon, PoseidonHasher};
use ark_bn254::Fr;
use ark_ff::PrimeField;
use ark_ff::BigInteger;
use sqlx::{sqlite::SqlitePool, Row};
use starknet::{
    core::types::{BlockId, EventFilter},
    providers::{jsonrpc::HttpTransport, JsonRpcClient, Provider},
};
use url::Url;
use std::time::Duration;
use num_bigint::BigUint;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MerklePathRequest {
    commitment: String,
    note_hash: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MerklePathResponse {
    root: String,
    path: Vec<String>,
    indices: Vec<u8>,
    index: u64,
    amount: String,
    commitment: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TokenInfo {
    address: String,
    name: String,
    symbol: String,
    decimals: u8,
    logo: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TokensResponse {
    tokens: Vec<TokenInfo>,
}

const TREE_HEIGHT: usize = 25;

struct AppState {
    db: SqlitePool,
    commitments: HashMap<String, u64>,
    note_to_commitment: HashMap<String, String>, // NoteHash -> Commitment
    commitment_to_amount: HashMap<String, String>, // Commitment -> Amount
    tree: Vec<Vec<Fr>>,
    zeros: [Fr; TREE_HEIGHT + 1],
    last_indexed_block: u64,
}

fn bn254_poseidon(left: Fr, right: Fr) -> Fr {
    let mut hasher = Poseidon::<Fr>::new_circom(2).unwrap();
    hasher.hash(&[left, right]).unwrap()
}

fn felt_to_fr(felt: FieldElement) -> Fr {
    Fr::from_be_bytes_mod_order(&felt.to_bytes_be())
}

fn fr_to_felt(fr: Fr) -> FieldElement {
    FieldElement::from_bytes_be(&fr.into_bigint().to_bytes_be().try_into().unwrap())
}

fn fr_to_hex(fr: Fr) -> String {
    let bu: BigUint = BigUint::from_bytes_be(&fr.into_bigint().to_bytes_be());
    format!("0x{:0>64}", bu.to_str_radix(16))
}

fn hex_to_fr(hex_str: &str) -> Fr {
    let clean_hex = hex_str.trim_start_matches("0x");
    let bu = BigUint::parse_bytes(clean_hex.as_bytes(), 16).unwrap();
    Fr::from_be_bytes_mod_order(&bu.to_bytes_be())
}

impl AppState {
    async fn new(db: SqlitePool) -> Self {
        let mut zeros = [Fr::from(0); TREE_HEIGHT + 1];
        for i in 0..TREE_HEIGHT {
            zeros[i + 1] = bn254_poseidon(zeros[i], zeros[i]);
        }

        let tree = vec![vec![]; TREE_HEIGHT + 1];
        let commitments = HashMap::new();
        let note_to_commitment = HashMap::new();
        let commitment_to_amount = HashMap::new();
        
        let rows = sqlx::query("SELECT commitment, leaf_index, note_hash, amount FROM leaves ORDER BY leaf_index ASC")
            .fetch_all(&db)
            .await
            .expect("Failed to load leaves from DB");

        let start_block = std::env::var("START_BLOCK")
            .unwrap_or_else(|_| "0".to_string())
            .parse::<u64>()
            .unwrap_or(0);

        let mut state = Self {
            db,
            commitments,
            note_to_commitment,
            commitment_to_amount,
            tree,
            zeros,
            last_indexed_block: start_block,
        };

        if let Ok(row) = sqlx::query("SELECT last_block FROM sync_state WHERE id = 1")
            .fetch_one(&state.db)
            .await {
            state.last_indexed_block = row.get::<i64, _>("last_block") as u64;
        }

        for row in rows {
            let comm_str: String = row.get("commitment");
            let index: i64 = row.get("leaf_index");
            let note_hash: Option<String> = row.get("note_hash");
            let amount: String = row.get("amount");
            let fr = hex_to_fr(&comm_str);
            state.commitments.insert(comm_str.clone(), index as u64);
            state.commitment_to_amount.insert(comm_str.clone(), amount);
            if let Some(nh) = note_hash {
                state.note_to_commitment.insert(nh, comm_str);
            }
            state.update_tree_in_memory(index as u64, fr);
        }

        state
    }

    fn update_tree_in_memory(&mut self, index: u64, leaf: Fr) {
        let mut current_idx = index;
        let mut current_val = leaf;
        
        if (index as usize) < self.tree[0].len() {
            self.tree[0][index as usize] = current_val;
        } else {
            self.tree[0].push(current_val);
        }

        for level in 0..TREE_HEIGHT {
            let next_level = level + 1;
            let sibling_idx = if current_idx % 2 == 0 { current_idx + 1 } else { current_idx - 1 };
            
            let left;
            let right;
            
            if current_idx % 2 == 0 {
                left = current_val;
                right = if (sibling_idx as usize) < self.tree[level].len() {
                    self.tree[level][sibling_idx as usize]
                } else {
                    self.zeros[level]
                };
            } else {
                right = current_val;
                left = self.tree[level][sibling_idx as usize];
            }

            let parent_val = bn254_poseidon(left, right);
            
            let parent_idx = current_idx / 2;
            if (parent_idx as usize) < self.tree[next_level].len() {
                self.tree[next_level][parent_idx as usize] = parent_val;
            } else {
                self.tree[next_level].push(parent_val);
            }

            current_val = parent_val;
            current_idx = parent_idx;
        }
    }

    async fn add_leaf(&mut self, commitment: Fr, note_hash_hex: String, amount_hex: String) -> anyhow::Result<()> {
        let comm_str = fr_to_hex(commitment);
        if self.commitments.contains_key(&comm_str) {
            return Ok(());
        }

        let index = self.tree[0].len() as u64;
        
        // Use INSERT OR IGNORE to handle edge cases where DB and memory are out of sync
        sqlx::query("INSERT OR IGNORE INTO leaves (commitment, leaf_index, note_hash, amount) VALUES (?, ?, ?, ?)")
            .bind(&comm_str)
            .bind(index as i64)
            .bind(&note_hash_hex)
            .bind(&amount_hex)
            .execute(&self.db)
            .await?;

        // Double check if it's there now (either inserted or was already there)
        // If it was already there, we should still ensure memory map is updated if it was missing
        if !self.commitments.contains_key(&comm_str) {
            // We need to know the actual index if it was already in the DB
            let (actual_index, actual_amount) = if let Ok(row) = sqlx::query("SELECT leaf_index, amount FROM leaves WHERE commitment = ?")
                .bind(&comm_str)
                .fetch_one(&self.db)
                .await 
            {
                (row.get::<i64, _>("leaf_index") as u64, row.get::<String, _>("amount"))
            } else {
                (index, amount_hex.clone())
            };

            self.commitments.insert(comm_str.clone(), actual_index);
            self.commitment_to_amount.insert(comm_str.clone(), actual_amount);
            self.note_to_commitment.insert(note_hash_hex, comm_str);
            self.update_tree_in_memory(actual_index, commitment);
        }
        
        Ok(())
    }
}

type SharedState = Arc<RwLock<AppState>>;

use dotenvy::dotenv;

#[tokio::main]
async fn main() {
    dotenv().ok();
    // Database setup
    let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:asp.db?mode=rwc".to_string());
    let db = SqlitePool::connect(&db_url).await.expect("Failed to connect to DB");

    // Run migrations
    sqlx::query("CREATE TABLE IF NOT EXISTS leaves (commitment TEXT PRIMARY KEY, leaf_index INTEGER NOT NULL, note_hash TEXT, amount TEXT)")
        .execute(&db).await.unwrap();
    
    // Check if amount column exists, if not add it (simple migration)
    let _ = sqlx::query("ALTER TABLE leaves ADD COLUMN amount TEXT").execute(&db).await;
    sqlx::query("CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY, last_block INTEGER NOT NULL)")
        .execute(&db).await.unwrap();
    sqlx::query("INSERT OR IGNORE INTO sync_state (id, last_block) VALUES (1, 0)")
        .execute(&db).await.unwrap();

    let state = Arc::new(RwLock::new(AppState::new(db).await));

    // Indexer task
    let indexer_state = Arc::clone(&state);
    tokio::spawn(async move {
        let rpc_url = std::env::var("STARKNET_RPC_URL")
            .unwrap_or_else(|_| "https://starknet-sepolia-rpc.publicnode.com".to_string());
        let provider = JsonRpcClient::new(HttpTransport::new(Url::parse(&rpc_url).unwrap()));
        let contract_address = FieldElement::from_hex(
            &std::env::var("ZYLITH_POOL_ADDRESS").unwrap_or_else(|_| "0x0".to_string())
        ).unwrap();

        loop {
            println!("Indexer: Checking for new Zylith events...");
            if let Err(e) = sync_events(&provider, &indexer_state, contract_address).await {
                eprintln!("Indexing error: {:?}", e);
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/get_path", post(get_merkle_path))
        .route("/tokens", get(get_tokens))
        .route("/health", get(health_check))
        .layer(cors)
        .with_state(state);

    let addr = "127.0.0.1:3001";
    println!("Zylith ASP Server running on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn sync_events(
    provider: &JsonRpcClient<HttpTransport>,
    state: &SharedState,
    contract_address: FieldElement,
) -> anyhow::Result<()> {
    let last_block = {
        let s = state.read().await;
        s.last_indexed_block
    };

    let latest_block = provider.block_number().await?;
    if last_block >= latest_block {
        return Ok(());
    }

    let deposit_selector = starknet::core::utils::get_selector_from_name("Deposit").unwrap();
    let filter = EventFilter {
        from_block: Some(BlockId::Number(last_block + 1)),
        to_block: Some(BlockId::Number(latest_block)),
        address: Some(contract_address),
        keys: Some(vec![vec![deposit_selector]]),
    };

    let events = provider.get_events(filter, None, 1000).await?;
    
    let mut s = state.write().await;
    for event in events.events {
        // Zylith Deposit event: data[0,1] is note_hash, data[2] is amount
        if let (Some(low), Some(high), Some(amount_felt)) = (event.data.get(0), event.data.get(1), event.data.get(2)) {
            let low_bu: BigUint = BigUint::from_bytes_be(&low.to_bytes_be());
            let high_bu: BigUint = BigUint::from_bytes_be(&high.to_bytes_be());
            let note_hash_bu: BigUint = (high_bu << 128) | low_bu;
            let note_hash_fr = Fr::from_be_bytes_mod_order(&note_hash_bu.to_bytes_be());
            
            let amount_bu: BigUint = BigUint::from_bytes_be(&amount_felt.to_bytes_be());
            let amount_fr = Fr::from_be_bytes_mod_order(&amount_bu.to_bytes_be());

            // If amount == 0, treat note_hash as a commitment (private ops).
            // Otherwise derive commitment as H(note_hash, amount).
            let commitment_fr = if amount_bu == BigUint::from(0u8) {
                note_hash_fr
            } else {
                bn254_poseidon(note_hash_fr, amount_fr)
            };
            let commitment_hex = fr_to_hex(commitment_fr);
            let note_hash_hex = format!("0x{:0>64}", note_hash_bu.to_str_radix(16));
            
            // Skip if already indexed in memory
            if s.commitments.contains_key(&commitment_hex) {
                continue;
            }

            println!("Indexer: Found new Deposit! NoteHash: {}, Amount: {}, Final Commitment: {}", 
                note_hash_hex, amount_bu, commitment_hex);
                
            if let Err(e) = s.add_leaf(commitment_fr, note_hash_hex, format!("0x{:x}", amount_bu)).await {
                eprintln!("Error adding leaf: {:?}. Continuing...", e);
            }
        }
    }

    s.last_indexed_block = latest_block;
    sqlx::query("UPDATE sync_state SET last_block = ? WHERE id = 1")
        .bind(latest_block as i64)
        .execute(&s.db)
        .await?;

    Ok(())
}

async fn health_check() -> &'static str {
    "Zylith ASP Server is healthy"
}

async fn get_tokens() -> Json<TokensResponse> {
    let tokens = vec![
        TokenInfo {
            address: std::env::var("TOKEN0_ADDRESS")
                .unwrap_or_else(|_| "0x0".to_string()),
            name: std::env::var("TOKEN0_NAME")
                .unwrap_or_else(|_| "TOKEN0".to_string()),
            symbol: std::env::var("TOKEN0_SYMBOL")
                .unwrap_or_else(|_| "TOKEN0".to_string()),
            decimals: std::env::var("TOKEN0_DECIMALS")
                .ok()
                .and_then(|v| v.parse::<u8>().ok())
                .unwrap_or(18),
            logo: std::env::var("TOKEN0_LOGO")
                .unwrap_or_else(|_| "".to_string()),
        },
        TokenInfo {
            address: std::env::var("TOKEN1_ADDRESS")
                .unwrap_or_else(|_| "0x0".to_string()),
            name: std::env::var("TOKEN1_NAME")
                .unwrap_or_else(|_| "TOKEN1".to_string()),
            symbol: std::env::var("TOKEN1_SYMBOL")
                .unwrap_or_else(|_| "TOKEN1".to_string()),
            decimals: std::env::var("TOKEN1_DECIMALS")
                .ok()
                .and_then(|v| v.parse::<u8>().ok())
                .unwrap_or(18),
            logo: std::env::var("TOKEN1_LOGO")
                .unwrap_or_else(|_| "".to_string()),
        },
    ];

    Json(TokensResponse { tokens })
}

async fn get_merkle_path(
    State(state): State<SharedState>,
    Json(payload): Json<MerklePathRequest>,
) -> Json<MerklePathResponse> {
    let state = state.read().await;
    
    let target_commitment = if let Some(nh) = &payload.note_hash {
        match state.note_to_commitment.get(nh) {
            Some(comm) => comm.clone(),
            None => payload.commitment.clone(),
        }
    } else {
        payload.commitment.clone()
    };

    let index = match state.commitments.get(&target_commitment) {
        Some(idx) => *idx,
        None => return Json(MerklePathResponse {
            root: "0x0".to_string(),
            path: vec![],
            indices: vec![],
            index: 0,
            amount: "0x0".to_string(),
            commitment: target_commitment,
        }),
    };

    let mut path = Vec::new();
    let mut indices = Vec::new();
    let mut current_idx = index;

    for level in 0..TREE_HEIGHT {
        let sibling_idx = if current_idx % 2 == 0 { current_idx + 1 } else { current_idx - 1 };
        let sibling_val = state.tree[level].get(sibling_idx as usize)
            .cloned()
            .unwrap_or(state.zeros[level]);
        
        path.push(fr_to_hex(sibling_val));
        indices.push((current_idx % 2) as u8);
        current_idx /= 2;
    }

    let root = state.tree[TREE_HEIGHT].get(0).cloned().unwrap_or(state.zeros[TREE_HEIGHT]);

    let amount = state.commitment_to_amount.get(&target_commitment)
        .cloned()
        .unwrap_or("0x0".to_string());

    Json(MerklePathResponse {
        root: fr_to_hex(root),
        path,
        indices,
        index,
        amount,
        commitment: target_commitment,
    })
}
