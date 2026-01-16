#[derive(Drop, Copy, Serde)]
pub struct SwapState {
    pub amount_specified_remaining: u128,
    pub amount_calculated: u128,
    pub sqrt_price: u256,
    pub tick: i32,
    pub liquidity: u128,
}

#[derive(Drop, Copy, Serde)]
pub struct StepState {
    pub sqrt_price_start: u256,
    pub next_tick: i32,
    pub initialized: bool,
    pub sqrt_price_next_tick: u256,
    pub amount_in: u128,
    pub amount_out: u128,
    pub fee_amount: u128,
}

pub mod SwapEngine {
    pub fn compute_fee_growth_delta(
        fee_amount: u128,
        liquidity: u128,
        protocol_fee_rate: u32
    ) -> (u128, u256) {
        if liquidity == 0 {
            return (0, 0);
        }
        let protocol_fee = (fee_amount.into() * protocol_fee_rate.into()) / 1000000_u256;
        let lp_fee = fee_amount.into() - protocol_fee;
        let q128 = 0x100000000000000000000000000000000_u256;
        let fee_growth_delta = (lp_fee * q128) / liquidity.into();
        (protocol_fee.try_into().unwrap(), fee_growth_delta)
    }
}
