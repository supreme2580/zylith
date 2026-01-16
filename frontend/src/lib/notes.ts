import { poseidon2 } from "poseidon-lite";

export interface ShieldedNote {
  token: string; // The token address this note belongs to
  secret: string;
  nullifier: string;
  amount: bigint;
  noteHash: string;
  commitment: string;
  index?: number;
  status: 'pending' | 'ready';
  type?: 'swap' | 'lp';
  tickLower?: number;
  tickUpper?: number;
}

/**
 * Creates a new shielded note with random entropy
 */
export function createShieldedNote(amount: bigint, token: string, type: 'swap' | 'lp' = 'swap', tickLower?: number, tickUpper?: number): ShieldedNote {
  const secret = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(31))).map(b => b.toString(16).padStart(2, '0')).join('');
  const nullifier = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(31))).map(b => b.toString(16).padStart(2, '0')).join('');
  
  const secretBI = BigInt(secret);
  const nullifierBI = BigInt(nullifier);
  
  // noteHash = Poseidon(secret, nullifier)
  const noteHash = poseidon2([secretBI, nullifierBI]);
  
  // commitment = Poseidon(noteHash, amount)
  const commitment = poseidon2([BigInt(noteHash), amount]);

  const toHex64 = (v: bigint | string) => {
    const hex = typeof v === 'string' ? BigInt(v).toString(16) : v.toString(16);
    return '0x' + hex.padStart(64, '0');
  };

  return {
    token,
    secret,
    nullifier,
    amount,
    noteHash: toHex64(noteHash),
    commitment: toHex64(commitment),
    status: 'pending',
    type,
    tickLower,
    tickUpper
  };
}

/**
 * Computes nullifier hash for a note
 */
export function computeNullifierHash(note: ShieldedNote): string {
  const secretBI = BigInt(note.secret);
  const noteHashBI = BigInt(note.noteHash);
  const commitmentBI = poseidon2([noteHashBI, note.amount]);
  
  const toHex64 = (v: bigint | string) => {
    const hex = typeof v === 'string' ? BigInt(v).toString(16) : v.toString(16);
    return '0x' + hex.padStart(64, '0');
  };

  // nullifierHash = Poseidon(secret, commitment)
  const nullifierHash = poseidon2([secretBI, commitmentBI]);
  return toHex64(nullifierHash);
}

/**
 * Persists notes to local storage (encrypted in production, but plaintext for MVP)
 */
export function saveNote(note: ShieldedNote) {
  const notes = getNotes();
  notes.push(note);
  localStorage.setItem('zylith_notes', JSON.stringify(notes, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value
  ));
}

export function markSpent(nullifierHash: string) {
  const stored = localStorage.getItem('zylith_spent_nullifiers');
  const list = stored ? (JSON.parse(stored) as string[]) : [];
  if (!list.includes(nullifierHash)) list.push(nullifierHash);
  localStorage.setItem('zylith_spent_nullifiers', JSON.stringify(list));
}

export function isSpent(nullifierHash: string): boolean {
  const stored = localStorage.getItem('zylith_spent_nullifiers');
  if (!stored) return false;
  const list = JSON.parse(stored) as string[];
  return list.includes(nullifierHash);
}

export function updateNoteStatus(oldCommitment: string, status: 'ready', newAmount?: bigint, newCommitment?: string) {
  const notes = getNotes();
  const updated = notes.map(n => {
    if (n.commitment === oldCommitment) {
      return { 
        ...n, 
        status, 
        amount: newAmount !== undefined ? newAmount : n.amount,
        commitment: newCommitment !== undefined ? newCommitment : n.commitment
      };
    }
    return n;
  });
  localStorage.setItem('zylith_notes', JSON.stringify(updated, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value
  ));
}

export function removeNote(note: ShieldedNote) {
  const notes = getNotes();
  const updated = notes.filter(n => n.commitment !== note.commitment);
  localStorage.setItem('zylith_notes', JSON.stringify(updated, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value
  ));
}

export function getNotes(): ShieldedNote[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem('zylith_notes');
  if (!stored) return [];
  return JSON.parse(stored, (key, value) => 
    key === 'amount' ? BigInt(value) : value
  );
}
