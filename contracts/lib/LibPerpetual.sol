// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.16;

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
        // total funding payed by liquidity providers
        int128 cumFundingPerLpToken;
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
        uint128 totalQuoteProvided;
        // total liquidity provided (in vBase)
        uint128 totalBaseProvided;
        // total funding payed by liquidity providers
        int128 cumFundingPerLpToken;
        // current trade amount in the block
        uint128 currentBlockTradeAmount;
        /* fees state */

        // total percentage return of liquidity providers index
        uint128 totalTradingFeesGrowth;
        // total base fees paid in cryptoswap pool
        uint128 totalBaseFeesGrowth;
        // total quote fees paid in cryptoswap pool
        uint128 totalQuoteFeesGrowth;
        // total long position of all traders
        uint128 traderLongs;
        // total short position of all traders
        uint128 traderShorts;
    }
}
