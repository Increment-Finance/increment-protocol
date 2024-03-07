// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// contracts
import {Perpetual} from "../Perpetual.sol";

// interfaces
import {ICryptoSwap} from "../interfaces/ICryptoSwap.sol";
import {IVBase} from "../interfaces/IVBase.sol";
import {IVQuote} from "../interfaces/IVQuote.sol";
import {IClearingHouse} from "../interfaces/IClearingHouse.sol";
import {ICurveCryptoViews} from "../interfaces/ICurveCryptoViews.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// libraries
import {LibPerpetual} from "../lib/LibPerpetual.sol";
import {LibMath} from "../lib/LibMath.sol";

/// @notice Emitted when the given token index is gt 1
error TestPerpetual_InvalidTokenIndex(uint256 idx);

/// @notice Emitted when the initial buy amount is less than the target position size
error TestPerpetual_BuyAmountTooSmall();

/*
 * TestPerpetual includes some setter functions to edit part of
 * the internal state of Perpetual which aren't exposed otherwise.
 */
contract TestPerpetual is Perpetual {
    using LibMath for int256;
    using LibMath for uint256;

    // emit event which can be cached in tests
    event SwapForExact(uint256 boughtVBaseTokens, uint256 additionalTokens);

    constructor(
        IVBase _vBase,
        IVQuote _vQuote,
        ICryptoSwap _market,
        IClearingHouse _clearingHouse,
        ICurveCryptoViews _views,
        PerpetualParams memory _params
    ) Perpetual(_vBase, _vQuote, _market, _clearingHouse, _views, _params) {}

    // simplified setter for funding rate manipulation
    function __TestPerpetual_setGlobalPositionFundingRate(uint64 timeOfLastTrade, int128 cumFundingRate) external {
        globalPosition.timeOfLastTrade = timeOfLastTrade;
        globalPosition.cumFundingRate = cumFundingRate;
    }

    // simplified setter for trading fees manipulation
    function __TestPerpetual_setGlobalPositionTradingFees(uint128 totalTradingFeesGrowth) external {
        globalPosition.totalTradingFeesGrowth = totalTradingFeesGrowth;
    }

    function __TestPerpetual_setTraderPosition(
        address trader,
        int128 openNotional,
        int128 positionSize,
        int128 cumFundingRate
    ) external {
        traderPosition[trader] = LibPerpetual.TraderPosition({
            openNotional: openNotional,
            positionSize: positionSize,
            cumFundingRate: cumFundingRate
        });
    }

    function __TestPerpetual_manipulate_market(
        uint256 tokenToSell,
        uint256 tokenToBuy,
        uint256 amountToSell
    ) external returns (uint256) {
        if (tokenToSell >= 2) revert TestPerpetual_InvalidTokenIndex(tokenToSell);
        if (tokenToBuy >= 2) revert TestPerpetual_InvalidTokenIndex(tokenToBuy);

        if (tokenToSell == VQUOTE_INDEX) {
            vQuote.mint(amountToSell);
        } else {
            vBase.mint(amountToSell);
        }

        return market.exchange(tokenToSell, tokenToBuy, amountToSell, 0);
    }

    function __TestPerpetual_swap_for_exact(uint256 proposedAmount, uint256 targetPositionSize) external {
        // mint tokens
        vQuote.mint(proposedAmount);

        (uint256 boughtVBaseTokens, ) = _quoteForBase(proposedAmount, 0);

        if (boughtVBaseTokens < targetPositionSize) revert TestPerpetual_BuyAmountTooSmall();

        uint256 baseRemaining = boughtVBaseTokens - targetPositionSize;

        emit SwapForExact(boughtVBaseTokens, baseRemaining);
    }

    function __TestPerpetual_updateGlobalState() external {
        _updateGlobalState();
    }

    function __TestPerpetual_updateFunding() external {
        _updateFundingRate();
    }

    function __TestPerpetual_updateTwap() external {
        _updateTwap();
    }

    function __TestPerpetual_setTWAP(int128 _marketTwap, int128 _oracleTwap) external {
        marketTwap = _marketTwap;
        oracleTwap = _oracleTwap;
    }

    function __TestPerpetual__updateCurrentBlockTradeAmount(uint256 quoteAmount) external {
        _updateCurrentBlockTradeAmount(quoteAmount);
    }

    function __TestPerpetual__resetCurrentBlockTradeAmount() external {
        _resetCurrentBlockTradeAmount();
    }

    function __TestPerpetual__checkBlockTradeAmount() external view returns (bool) {
        return _checkBlockTradeAmount();
    }

    // perform a removal of liquidity and swap in one function call
    function __TestPerpetual_remove_liquidity_swap(
        ICryptoSwap market_,
        ICurveCryptoViews views_,
        IVBase vBase_,
        uint256 liquidityAmountToRemove,
        uint256 globalTotalBaseFeesGrowth,
        uint256 lpTotalBaseFeesGrowth,
        uint256 proposedAmount
    ) public returns (uint256 baseLiquidity, uint256 baseProceeds) {
        baseLiquidity = _removeLiquidity(
            market_,
            vBase_,
            liquidityAmountToRemove,
            globalTotalBaseFeesGrowth,
            lpTotalBaseFeesGrowth
        );
        baseProceeds = __TestPerpetual__quoteForBase(proposedAmount, market_, views_);

        return (baseLiquidity, baseProceeds);
    }

    // optimized version of _removeLiquidity
    function _removeLiquidity(
        ICryptoSwap market_,
        IVBase vBase_,
        uint256 liquidityAmountToRemove,
        uint256 globalTotalBaseFeesGrowth,
        uint256 lpTotalBaseFeesGrowth
    ) internal returns (uint256 baseAmount) {
        // remove liquidity
        uint256 vBaseBalanceBefore = vBase_.balanceOf(address(this));

        market_.remove_liquidity(liquidityAmountToRemove, [uint256(0), uint256(0)]);

        uint256 baseAmountInclFees = vBase_.balanceOf(address(this)) - vBaseBalanceBefore;

        // remove fee component from quoteAmount
        baseAmount = baseAmountInclFees.wadDiv(1e18 + globalTotalBaseFeesGrowth - lpTotalBaseFeesGrowth);
    }

    // optimized version of _quoteForBase
    function __TestPerpetual__quoteForBase(
        uint256 quoteAmount,
        ICryptoSwap _market,
        ICurveCryptoViews _views
    ) internal view returns (uint256) {
        return _views.get_dy_ex_fees(_market, VQUOTE_INDEX, VBASE_INDEX, quoteAmount);
    }

    function getOracleCumulativeAmount() external view returns (int256) {
        return oracleCumulativeAmount;
    }

    function getOracleCumulativeAmountAtBeginningOfPeriod() external view returns (int256) {
        return oracleCumulativeAmountAtBeginningOfPeriod;
    }

    function getMarketCumulativeAmount() external view returns (int256) {
        return marketCumulativeAmount;
    }

    function getMarketCumulativeAmountAtBeginningOfPeriod() external view returns (int256) {
        return marketCumulativeAmountAtBeginningOfPeriod;
    }
}
