pub mod TickBitmap {
    pub fn next_initialized_tick_within_one_word(
        bitmap: u256,
        tick: i32,
        tick_spacing: i32,
        zero_for_one: bool
    ) -> (i32, bool) {
        let compressed = if tick < 0 && tick % tick_spacing != 0 {
            (tick / tick_spacing) - 1
        } else {
            tick / tick_spacing
        };

        if zero_for_one {
            let (_, bit_pos) = position(compressed);
            let mask = if bit_pos == 255 {
                0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff_u256
            } else {
                bit_mask(bit_pos + 1) - 1
            };
            let masked = bitmap & mask;

            if masked != 0 {
                let bit = most_significant_bit(masked);
                let next = (compressed - (bit_pos.into() - bit.into())) * tick_spacing;
                (next, true)
            } else {
                let next = (compressed - bit_pos.into()) * tick_spacing;
                (next, false)
            }
        } else {
            let (_, bit_pos) = position(compressed + 1);
            let mask = if bit_pos == 255 {
                0
            } else {
                ~ (bit_mask(bit_pos + 1) - 1)
            };
            let masked = bitmap & mask;

            if masked != 0 {
                let bit = least_significant_bit(masked);
                let next = (compressed + 1 + (bit.into() - bit_pos.into())) * tick_spacing;
                (next, true)
            } else {
                let next = (compressed + 1 + (255 - bit_pos.into())) * tick_spacing;
                (next, false)
            }
        }
    }

    pub fn position(tick: i32) -> (i16, u8) {
        // Manual Euclidean division (Cairo lacks div_euclid/rem_euclid)
        let mut word: i32 = tick / 256;
        let mut rem: i32 = tick % 256;
        if rem < 0 {
            rem += 256;
            word -= 1;
        }
        let word_pos: i16 = word.try_into().expect('word_pos overflow');
        let bit_pos: u8 = rem.try_into().expect('bit_pos overflow');
        (word_pos, bit_pos)
    }

    pub fn bit_mask(bit_pos: u8) -> u256 {
        let mut res: u256 = 1;
        let mut i = 0_u8;
        loop {
            if i >= bit_pos { break; }
            res *= 2;
            i += 1;
        };
        res
    }

    pub fn most_significant_bit(mut x: u256) -> u8 {
        let mut msb: u8 = 0;
        if x >= 0x100000000000000000000000000000000 { x /= 0x100000000000000000000000000000000; msb += 128; }
        if x >= 0x10000000000000000 { x /= 0x10000000000000000; msb += 64; }
        if x >= 0x100000000 { x /= 0x100000000; msb += 32; }
        if x >= 0x10000 { x /= 0x10000; msb += 16; }
        if x >= 0x100 { x /= 0x100; msb += 8; }
        if x >= 0x10 { x /= 0x10; msb += 4; }
        if x >= 0x4 { x /= 0x4; msb += 2; }
        if x >= 0x2 { msb += 1; }
        msb
    }

    pub fn least_significant_bit(mut x: u256) -> u8 {
        let mut lsb: u8 = 0;
        if (x % 0x100000000000000000000000000000000) == 0 { x /= 0x100000000000000000000000000000000; lsb += 128; }
        if (x % 0x10000000000000000) == 0 { x /= 0x10000000000000000; lsb += 64; }
        if (x % 0x100000000) == 0 { x /= 0x100000000; lsb += 32; }
        if (x % 0x10000) == 0 { x /= 0x10000; lsb += 16; }
        if (x % 0x100) == 0 { x /= 0x100; lsb += 8; }
        if (x % 0x10) == 0 { x /= 0x10; lsb += 4; }
        if (x % 0x4) == 0 { x /= 0x4; lsb += 2; }
        if (x % 0x2) == 0 { lsb += 1; }
        lsb
    }
}
