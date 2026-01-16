pub mod FixedPoint {
    pub const Q96: u256 = 0x1000000000000000000000000; // 2^96

    pub fn mul_div(a: u256, b: u256, denominator: u256) -> u256 {
        if a == 0 || b == 0 {
            return 0;
        }
        // Robust mul_div to avoid intermediate u256 overflow:
        // (a * b) / d = (a / d) * b + (a % d) * b / d
        (a / denominator) * b + (a % denominator) * b / denominator
    }
}

pub mod SqrtPriceMath {
    use super::FixedPoint;

    pub fn get_next_sqrt_price_from_input(
        sqrt_price: u256,
        liquidity: u128,
        amount_in: u128,
        zero_for_one: bool
    ) -> u256 {
        let liquidity_u256: u256 = liquidity.into();
        let amount_in_u256: u256 = amount_in.into();

        if zero_for_one {
            // Original: (L * Q96 * sqrt) / (L * Q96 + amount_in * sqrt)
            // Reordered to avoid u256 overflow: (sqrt * Q96) / (Q96 + (amount_in * sqrt / L))
            let den_part = FixedPoint::mul_div(amount_in_u256, sqrt_price, liquidity_u256);
            FixedPoint::mul_div(sqrt_price, FixedPoint::Q96, FixedPoint::Q96 + den_part)
        } else {
            // Original: sqrt + (amount_in * Q96 / L)
            sqrt_price + FixedPoint::mul_div(amount_in_u256, FixedPoint::Q96, liquidity_u256)
        }
    }

    pub fn get_amount_0_delta(
        sqrt_price_a: u256,
        sqrt_price_b: u256,
        liquidity: u128,
        round_up: bool
    ) -> u128 {
        if sqrt_price_a == sqrt_price_b {
            return 0;
        }
        let (p_low, p_up) = if sqrt_price_a < sqrt_price_b { (sqrt_price_a, sqrt_price_b) } else { (sqrt_price_b, sqrt_price_a) };

        assert(p_low > 0, 'Invalid sqrt lower');
        assert(p_up > 0, 'Invalid sqrt upper');

        let diff = p_up - p_low;
        
        // Formula: L * diff * Q96 / (p_upper * p_lower)
        // Reordered: (L * diff / p_upper) * Q96 / p_lower
        let res = FixedPoint::mul_div(liquidity.into(), diff, p_up);
        let res = FixedPoint::mul_div(res, FixedPoint::Q96, p_low);
        
        res.try_into().unwrap()
    }

    pub fn get_amount_1_delta(
        sqrt_price_a: u256,
        sqrt_price_b: u256,
        liquidity: u128,
        round_up: bool
    ) -> u128 {
        if sqrt_price_a == sqrt_price_b {
            return 0;
        }
        let (p_low, p_up) = if sqrt_price_a < sqrt_price_b { (sqrt_price_a, sqrt_price_b) } else { (sqrt_price_b, sqrt_price_a) };

        // Formula: L * diff / Q96
        let res = FixedPoint::mul_div(liquidity.into(), p_up - p_low, FixedPoint::Q96);
        res.try_into().unwrap()
    }

    pub fn get_liquidity_from_amount_0(
        sqrt_price_a: u256,
        sqrt_price_b: u256,
        amount_0: u128
    ) -> u128 {
        if sqrt_price_a == sqrt_price_b {
            return 0;
        }
        let (p_low, p_up) = if sqrt_price_a < sqrt_price_b { (sqrt_price_a, sqrt_price_b) } else { (sqrt_price_b, sqrt_price_a) };

        // Formula: amount_0 * p_upper * p_lower / (diff * Q96)
        // intermediate = (p_upper * p_lower) / Q96
        let intermediate = FixedPoint::mul_div(p_up, p_low, FixedPoint::Q96);
        let res = FixedPoint::mul_div(amount_0.into(), intermediate, p_up - p_low);
        res.try_into().unwrap()
    }

    pub fn get_liquidity_from_amount_1(
        sqrt_price_a: u256,
        sqrt_price_b: u256,
        amount_1: u128
    ) -> u128 {
        if sqrt_price_a == sqrt_price_b {
            return 0;
        }
        let (p_low, p_up) = if sqrt_price_a < sqrt_price_b { (sqrt_price_a, sqrt_price_b) } else { (sqrt_price_b, sqrt_price_a) };

        // Formula: amount_1 * Q96 / diff
        let res = FixedPoint::mul_div(amount_1.into(), FixedPoint::Q96, p_up - p_low);
        res.try_into().unwrap()
    }
}

pub mod LiquidityMath {
    pub fn add_delta(liquidity: u128, delta: i128) -> u128 {
        if delta >= 0 {
            liquidity + delta.try_into().unwrap()
        } else {
            liquidity - (-delta).try_into().unwrap()
        }
    }
}
