use super::pool_state::{TickInfo};

pub mod FeeEngine {
    use super::{TickInfo};

    pub fn get_fee_growth_inside(
        tick_current: i32,
        tick_lower: i32,
        tick_upper: i32,
        lower: TickInfo,
        upper: TickInfo,
        fee_growth_global_0: u256,
        fee_growth_global_1: u256,
    ) -> (u256, u256) {
        let (f_g_0_l, f_g_1_l) = if tick_current >= tick_lower {
            (lower.fee_growth_outside_0, lower.fee_growth_outside_1)
        } else {
            (fee_growth_global_0 - lower.fee_growth_outside_0, fee_growth_global_1 - lower.fee_growth_outside_1)
        };

        let (f_g_0_u, f_g_1_u) = if tick_current < tick_upper {
            (upper.fee_growth_outside_0, upper.fee_growth_outside_1)
        } else {
            (fee_growth_global_0 - upper.fee_growth_outside_0, fee_growth_global_1 - upper.fee_growth_outside_1)
        };

        (fee_growth_global_0 - f_g_0_l - f_g_0_u, fee_growth_global_1 - f_g_1_l - f_g_1_u)
    }
}
