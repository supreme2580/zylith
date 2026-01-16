use super::math::SqrtPriceMath;

#[derive(Copy, Drop, Serde)]
pub struct SwapStepResult {
    pub sqrt_price_next: u256,
    pub amount_in: u128,
    pub amount_out: u128,
    pub fee_amount: u128,
}

pub mod SwapStep {
    use super::SwapStepResult;
    use super::SqrtPriceMath;

    pub fn compute_swap_step(
        sqrt_price_current: u256,
        sqrt_price_target: u256,
        liquidity: u128,
        amount_remaining: u128,
        fee_pips: u32,
    ) -> SwapStepResult {
        let zero_for_one = sqrt_price_current >= sqrt_price_target;
        
        let amount_remaining_u256: u256 = amount_remaining.into();
        let fee_pips_u256: u256 = fee_pips.into();
        let amount_remaining_less_fee = (amount_remaining_u256 * (1_000_000 - fee_pips_u256) / 1_000_000);
        let amount_remaining_less_fee_u128: u128 = amount_remaining_less_fee.try_into().unwrap();

        // Calculate max amount in for this step to reach target price
        let mut amount_in = if zero_for_one {
            SqrtPriceMath::get_amount_0_delta(sqrt_price_target, sqrt_price_current, liquidity, true)
        } else {
            SqrtPriceMath::get_amount_1_delta(sqrt_price_current, sqrt_price_target, liquidity, true)
        };

        let mut sqrt_price_next = sqrt_price_target;
        let mut fee_amount: u128 = 0;

        if amount_remaining_less_fee_u128 < amount_in {
            // Amount remaining is not enough to reach target price
            sqrt_price_next = SqrtPriceMath::get_next_sqrt_price_from_input(
                sqrt_price_current, liquidity, amount_remaining_less_fee_u128, zero_for_one
            );
            amount_in = amount_remaining_less_fee_u128;
            fee_amount = amount_remaining - amount_in;
        } else {
            fee_amount = (amount_in.into() * fee_pips_u256 / (1_000_000 - fee_pips_u256)).try_into().unwrap();
        }

        let amount_out = if zero_for_one {
            SqrtPriceMath::get_amount_1_delta(sqrt_price_next, sqrt_price_current, liquidity, false)
        } else {
            SqrtPriceMath::get_amount_0_delta(sqrt_price_current, sqrt_price_next, liquidity, false)
        };

        SwapStepResult {
            sqrt_price_next,
            amount_in,
            amount_out,
            fee_amount,
        }
    }
}
