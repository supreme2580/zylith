use super::pool_state::{TickInfo, Position};

pub mod LiquidityEngine {
    use super::{TickInfo, Position};

    pub fn update_tick(
        ref tick_info: TickInfo,
        liquidity_delta: i128,
        fee_growth_global_0: u256,
        fee_growth_global_1: u256,
        upper: bool
    ) {
        if tick_info.liquidity_delta == 0 {
            if !upper {
                tick_info.fee_growth_outside_0 = fee_growth_global_0;
                tick_info.fee_growth_outside_1 = fee_growth_global_1;
            }
        }

        if liquidity_delta >= 0 {
            tick_info.liquidity_delta += liquidity_delta.try_into().unwrap();
        } else {
            tick_info.liquidity_delta -= (-liquidity_delta).try_into().unwrap();
        }

        if !upper {
            tick_info.liquidity_net += liquidity_delta;
        } else {
            tick_info.liquidity_net -= liquidity_delta;
        }
    }

    pub fn update_position(
        ref position: Position,
        liquidity_delta: i128,
        fee_growth_inside_0: u256,
        fee_growth_inside_1: u256
    ) {
        if liquidity_delta != 0 {
            if liquidity_delta >= 0 {
                position.liquidity += liquidity_delta.try_into().unwrap();
            } else {
                position.liquidity -= (-liquidity_delta).try_into().unwrap();
            }
        }

        // Calculate and accumulate fees
        // Formula: owed += (fee_growth_inside - fee_growth_inside_last) * liquidity / 2^128
        // Note: Global growth is u256, delta should fit in u256. 
        // We use 128-bit scaling for the division as per Uniswap v3.
        
        let q128: u256 = 340282366920938463463374607431768211456; // 2^128

        if fee_growth_inside_0 >= position.fee_growth_inside_0_last {
            let delta0 = fee_growth_inside_0 - position.fee_growth_inside_0_last;
            let owed0 = (delta0 * position.liquidity.into()) / q128;
            position.tokens_owed_0 += owed0.try_into().unwrap();
        }

        if fee_growth_inside_1 >= position.fee_growth_inside_1_last {
            let delta1 = fee_growth_inside_1 - position.fee_growth_inside_1_last;
            let owed1 = (delta1 * position.liquidity.into()) / q128;
            position.tokens_owed_1 += owed1.try_into().unwrap();
        }

        position.fee_growth_inside_0_last = fee_growth_inside_0;
        position.fee_growth_inside_1_last = fee_growth_inside_1;
    }
}
