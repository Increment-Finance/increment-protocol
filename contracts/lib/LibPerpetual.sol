// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// libraries
import {LibMath} from "./LibMath.sol";

library LibPerpetual {
    using LibMath for int256;
    using LibMath for uint256;

    enum Side {
        // long position
        Long,
        // short position
        Short
    }

    struct LiquidityProviderPosition {
        // quote assets or liabilities
        int128 openNotional;
        // base assets or liabilities
        int128 positionSize;
        // user cumulative funding rate (updated when open/close position)
        int128 cumFundingRate;
        // lp token owned (is zero for traders)
        uint128 liquidityBalance;

        // last time when liquidity was provided
        uint64 depositTime;

        // total percentage return of liquidity providers index
        uint128 totalTradingFeesGrowth;
        // total base fees paid in cryptoswap pool
        uint128 totalBaseFeesGrowth;
        // total quote fees paid in cryptoswap pool
        uint128 totalQuoteFeesGrowth;
    }

    struct TraderPosition {
        // quote assets or liabilities
        int128 openNotional;
        // base assets or liabilities
        int128 positionSize;
        // user cumulative funding rate (updated when open/close position)
        int128 cumFundingRate;
    }

    struct GlobalPosition {
        /* twap state */

        // timestamp of last trade
        uint64 timeOfLastTrade;
        // timestamp of last TWAP update
        uint64 timeOfLastTwapUpdate;
        // global cumulative funding rate (updated every trade)
        int128 cumFundingRate;

        // total liquidity provided (in vQuote)
        uint256 totalQuoteProvided;
        // current trade amount in the block
        uint128 currentBlockTradeAmount;
        /* fees state */

        // total percentage return of liquidity providers index
        uint128 totalTradingFeesGrowth;
        // total base fees paid in cryptoswap pool
        uint128 totalBaseFeesGrowth;
        // total quote fees paid in cryptoswap pool
        uint128 totalQuoteFeesGrowth;
    }
}
