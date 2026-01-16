#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct PoolState {
    pub sqrt_price: u256, // Q64.96 fixed point
    pub tick: i32,
    pub liquidity: u128,
    pub fee_growth_global_0: u256,
    pub fee_growth_global_1: u256,
    pub protocol_fee_0: u128,
    pub protocol_fee_1: u128,
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct TickInfo {
    pub liquidity_net: i128,
    pub liquidity_delta: u128,
    pub fee_growth_outside_0: u256,
    pub fee_growth_outside_1: u256,
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Position {
    pub liquidity: u128,
    pub fee_growth_inside_0_last: u256,
    pub fee_growth_inside_1_last: u256,
    pub tokens_owed_0: u128,
    pub tokens_owed_1: u128,
}
