pub mod TickMath {

    pub const MIN_TICK: i32 = -887272;
    pub const MAX_TICK: i32 = 887272;
    
    // 2^96 as u256
    fn q96() -> u256 {
        0x1000000000000000000000000_u256
    }

    // 2^128 as u256 (used internally for higher precision)
    fn q128() -> u256 {
        0x100000000000000000000000000000000_u256
    }

    pub fn get_sqrt_ratio_at_tick(tick: i32) -> u256 {
        let abs_tick: u32 = if tick < 0 {
            (-tick).try_into().unwrap()
        } else {
            tick.try_into().unwrap()
        };
        assert(abs_tick <= MAX_TICK.try_into().unwrap(), 'Tick out of range');

        let mut ratio: u256 = q128();

        if (abs_tick & 0x1) != 0 {
            ratio = (ratio * 0xfffcb933bd6fad37aa2d162d1a594001) / q128();
        }
        if (abs_tick & 0x2) != 0 {
            ratio = (ratio * 0xfff97272373d413259a46990580e213a) / q128();
        }
        if (abs_tick & 0x4) != 0 {
            ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) / q128();
        }
        if (abs_tick & 0x8) != 0 {
            ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) / q128();
        }
        if (abs_tick & 0x10) != 0 {
            ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) / q128();
        }
        if (abs_tick & 0x20) != 0 {
            ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) / q128();
        }
        if (abs_tick & 0x40) != 0 {
            ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) / q128();
        }
        if (abs_tick & 0x80) != 0 {
            ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) / q128();
        }
        if (abs_tick & 0x100) != 0 {
            ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) / q128();
        }
        if (abs_tick & 0x200) != 0 {
            ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) / q128();
        }
        if (abs_tick & 0x400) != 0 {
            ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) / q128();
        }
        if (abs_tick & 0x800) != 0 {
            ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) / q128();
        }
        if (abs_tick & 0x1000) != 0 {
            ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) / q128();
        }
        if (abs_tick & 0x2000) != 0 {
            ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) / q128();
        }
        if (abs_tick & 0x4000) != 0 {
            ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) / q128();
        }
        if (abs_tick & 0x8000) != 0 {
            ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) / q128();
        }
        if (abs_tick & 0x10000) != 0 {
            ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) / q128();
        }
        if (abs_tick & 0x20000) != 0 {
            ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) / q128();
        }
        if (abs_tick & 0x40000) != 0 {
            ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) / q128();
        }
        if (abs_tick & 0x80000) != 0 {
            ratio = (ratio * 0x48a170391f7dc42444e8fa2) / q128();
        }

        if tick > 0 {
            ratio = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff / ratio;
        }

        // Convert from Q128 to Q96 (rounding up if remainder)
        let remainder = ratio & 0xffffffff_u256;
        let mut sqrt_price_x96: u256 = ratio / 0x100000000_u256;
        if remainder > 0 {
            sqrt_price_x96 += 1;
        }
        sqrt_price_x96
    }

    pub fn get_tick_at_sqrt_ratio(sqrt_ratio: u256) -> i32 {
        // Safe binary search for MVP correctness.
        // This avoids precision issues and guarantees monotonic correctness.
        assert(sqrt_ratio > 0, 'Invalid sqrt ratio');

        let mut low: i32 = MIN_TICK;
        let mut high: i32 = MAX_TICK;
        let mut best: i32 = MIN_TICK;

        loop {
            if low > high {
                break;
            }
            let mid: i32 = low + ((high - low) / 2);
            let mid_ratio = get_sqrt_ratio_at_tick(mid);

            if mid_ratio <= sqrt_ratio {
                best = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        };

        best
    }
}
