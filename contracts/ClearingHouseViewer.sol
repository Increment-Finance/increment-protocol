// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// contracts
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// interfaces
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IClearingHouse} from "./interfaces/IClearingHouse.sol";
import {IClearingHouseViewer} from "./interfaces/IClearingHouseViewer.sol";
import {ICryptoSwap} from "./interfaces/ICryptoSwap.sol";

// libraries
import {LibMath} from "./lib/LibMath.sol";
import {LibPerpetual} from "./lib/LibPerpetual.sol";

/// @title Clearing House Helper Contract
/// @notice Utility functions to easily extract data from Perpetual Contracts
contract ClearingHouseViewer is IClearingHouseViewer {
    using LibMath for uint256;
    using LibMath for int256;
    using SafeERC20 for IERC20Metadata;

    // constants
    uint256 internal constant VQUOTE_INDEX = 0; // index of quote asset in curve pool
    uint256 internal constant VBASE_INDEX = 1; // index of base asset in curve pool

    // dependencies
    IClearingHouse public clearingHouse;

    constructor(IClearingHouse _clearingHouse) {
        if (address(_clearingHouse) == address(0)) revert ClearingHouseViewer_ZeroAddressConstructor(0);
        clearingHouse = _clearingHouse;
    }

    /* ****************** */
    /*   Market viewer    */
    /* ****************** */

    /// @notice Return amount for vBase one would receive for exchanging `vQuoteAmountToSpend` in a select market (excluding slippage)
    /// @dev It's up to the client to apply a reduction of this amount (e.g. -1%) to then use it as a reasonable value for `minAmount` in `extendPosition`
    /// @param idx Index of the perpetual market
    /// @param vQuoteAmountToSpend Amount of vQuote to be exchanged against some vBase. 18 decimals
    function getExpectedVBaseAmount(uint256 idx, uint256 vQuoteAmountToSpend) external view override returns (uint256) {
        return clearingHouse.perpetuals(idx).market().get_dy(VQUOTE_INDEX, VBASE_INDEX, vQuoteAmountToSpend);
    }

    /// @notice Return amount for vQuote one would receive for exchanging `vBaseAmountToSpend` in a select market (excluding slippage)
    /// @dev It's up to the client to apply a reduction of this amount (e.g. -1%) to then use it as a reasonable value for `minAmount` in `extendPosition`
    /// @param idx Index of the perpetual market
    /// @param vBaseAmountToSpend Amount of vBase to be exchanged against some vQuote. 18 decimals
    function getExpectedVQuoteAmount(uint256 idx, uint256 vBaseAmountToSpend) external view override returns (uint256) {
        return clearingHouse.perpetuals(idx).market().get_dy(VBASE_INDEX, VQUOTE_INDEX, vBaseAmountToSpend);
    }

    /// @notice Return the last traded price (used for TWAP)
    /// @param idx Index of the perpetual market
    function marketPrice(uint256 idx) public view override returns (uint256) {
        return clearingHouse.perpetuals(idx).marketPrice();
    }

    /// @notice Return the current off-chain exchange rate for vBase/vQuote
    /// @param idx Index of the perpetual market
    function indexPrice(uint256 idx) external view override returns (int256) {
        return clearingHouse.perpetuals(idx).indexPrice();
    }

    /// @notice Return a the GlobalPosition struct of a given market
    /// @param idx Index of the perpetual market
    function getGlobalPosition(uint256 idx) external view override returns (LibPerpetual.GlobalPosition memory) {
        return clearingHouse.perpetuals(idx).getGlobalPosition();
    }

    /// @notice Return the address of the curve market from a perpetual index
    /// @param idx Index of the perpetual market
    function getMarket(uint256 idx) public view override returns (ICryptoSwap) {
        return clearingHouse.perpetuals(idx).market();
    }

    /// @notice Return the insurance fee of a perpetual market
    /// @param idx Index of the perpetual market
    function insuranceFee(uint256 idx) external view override returns (int256) {
        return clearingHouse.perpetuals(idx).insuranceFee();
    }

    /// @notice Return the total supply of base tokens provided to a perpetual market
    /// @param idx Index of the perpetual market
    function getBaseBalance(uint256 idx) external view override returns (uint256) {
        return clearingHouse.perpetuals(idx).vBase().totalSupply();
    }

    /// @notice Return the total supply of quote tokens provided to a perpetual market
    /// @param idx Index of the perpetual market
    function getQuoteBalance(uint256 idx) external view override returns (uint256) {
        return clearingHouse.perpetuals(idx).vQuote().totalSupply();
    }

    /// @notice Return the total supply of liquidity tokens in a perpetual market
    /// @param idx Index of the perpetual market
    function getTotalLiquidityProvided(uint256 idx) external view override returns (uint256) {
        return clearingHouse.perpetuals(idx).getTotalLiquidityProvided();
    }

    /* ****************** */
    /*   User viewer      */
    /* ****************** */

    /// @notice Get free collateral of a user, with a given ratio applied on his debts
    /// @dev free collateral = profit + discounted collaterals USD value
    function getFreeCollateralByRatio(address account, int256 ratio) external view returns (int256 freeCollateral) {
        int256 pnl = clearingHouse.getPnLAcrossMarkets(account);
        int256 fundingPayments = getFundingPaymentsAcrossMarkets(account);

        int256 userDebt = clearingHouse.getDebtAcrossMarkets(account);
        int256 marginRequired = userDebt.wadMul(ratio);

        // if no trading or LP position open on any market, margin ratio is 100%
        if (userDebt == 0) {
            return 1e18;
        }
        int256 reserveValue = getReserveValue(account, false);

        // We define freeCollateral as follows:
        // freeCollateral = min(totalCollateralValue, totalCollateralValue + pnl) - marginRequired)
        // This is a conservative approach when compared to
        // freeCollateral = totalCollateralValue + pnl - marginRequired
        // since the unrealized pnl depends on the index price
        // where a deviation could allow a trader to empty the vault

        return reserveValue.min(reserveValue + pnl) + fundingPayments - marginRequired;
    }

    /// @notice Approximately determine whether or not a position is valid for a given margin ratio
    /// @dev Differ from `ClearingHouse._isPositionValid` in that it includes an estimate of pending funding payments,
    ///      also `_isPositionValid` formula is arranged differently
    /// @param account Account of the position to get the margin ratio from
    /// @param ratio Proposed ratio to compare the position against
    function isMarginValid(address account, int256 ratio) external view override returns (bool) {
        return marginRatio(account) >= ratio;
    }

    /// @notice Get the margin ratio of a user, i.e. all trading and LP positions across all markets
    /// @dev Unlike ClearingHouse.getFreeCollateralByRatio, ClearingHouseViewer.marginRatio includes fundingPayments
    ///      and formula is arranged differently
    /// @param account Account of the position to get the margin ratio from
    function marginRatio(address account) public view override returns (int256) {
        // margin ratio = (collateral + unrealizedPositionPnl) / trader.openNotional
        // all amounts must be expressed in vQuote (e.g. USD), otherwise the end result doesn't make sense

        int256 unrealizedPositionPnl = clearingHouse.getPnLAcrossMarkets(account);
        int256 userDebt = clearingHouse.getDebtAcrossMarkets(account);
        int256 fundingPayments = getFundingPaymentsAcrossMarkets(account);

        // if no trading or LP position open on any market, margin ratio is 100%
        if (userDebt == 0) {
            return 1e18;
        }

        int256 collateral = getReserveValue(account, false);

        return _computeMarginRatio(collateral, unrealizedPositionPnl, fundingPayments, userDebt);
    }

    /// @notice Get the funding payments of an user across all perpetual markets
    /// @param account User to get the funding payments of
    function getFundingPaymentsAcrossMarkets(address account) public view override returns (int256 fundingPayments) {
        for (uint256 i = 0; i < clearingHouse.getNumMarkets(); i++) {
            fundingPayments +=
                clearingHouse.perpetuals(i).getTraderFundingPayments(account) +
                clearingHouse.perpetuals(i).getLpFundingPayments(account);
        }
    }

    /// @notice Calculate missed funding payments
    /// @param idx Index of the perpetual market
    /// @param account User to get the funding payments of
    function getTraderFundingPayments(uint256 idx, address account) external view override returns (int256) {
        return clearingHouse.perpetuals(idx).getTraderFundingPayments(account);
    }

    /// @notice Calculate missed funding payments
    /// @param idx Index of the perpetual market
    /// @param account Trader to get the unrealized PnL from
    function getTraderUnrealizedPnL(uint256 idx, address account) external view override returns (int256) {
        if (!isTraderPositionOpen(idx, account)) {
            return 0;
        }

        return clearingHouse.perpetuals(idx).getTraderUnrealizedPnL(account);
    }

    /// @notice Get the portfolio value of a trader / lp
    /// @param account Address to get the portfolio value from
    /// @param isDiscounted Whether or not the reserve value should be discounted by the weight of the collateral
    /// @return reserveValue Value of collaterals in USD. 18 decimals
    function getReserveValue(address account, bool isDiscounted) public view override returns (int256) {
        return clearingHouse.vault().getReserveValue(account, isDiscounted);
    }

    /// @notice Get User LP balance
    /// @param user User to get the balance of
    /// @param tokenIdx Token to get the balance of
    function getBalance(address user, uint256 tokenIdx) external view override returns (int256) {
        return clearingHouse.vault().getBalance(user, tokenIdx);
    }

    /// @notice Get trader position
    /// @param idx Index of the perpetual market
    /// @param account Address to get the trading position from
    function getTraderPosition(uint256 idx, address account)
        public
        view
        override
        returns (LibPerpetual.TraderPosition memory)
    {
        return clearingHouse.perpetuals(idx).getTraderPosition(account);
    }

    /// @notice Whether a given trader position is open
    /// @param idx Index of the perpetual market
    /// @param account Address of the trading account
    function isTraderPositionOpen(uint256 idx, address account) public view override returns (bool) {
        return clearingHouse.perpetuals(idx).isTraderPositionOpen(account);
    }

    /// @notice Whether a given LP position is open
    /// @param idx Index of the perpetual market
    /// @param account Address of the LP account
    function isLpPositionOpen(uint256 idx, address account) public view override returns (bool) {
        return clearingHouse.perpetuals(idx).isLpPositionOpen(account);
    }

    /// @notice Calculate missed funding payments
    /// @param idx Index of the perpetual market
    /// @param account Lp to get the funding payments
    function getLpFundingPayments(uint256 idx, address account) external view override returns (int256) {
        return clearingHouse.perpetuals(idx).getLpFundingPayments(account);
    }

    /// @param idx Index of the perpetual market
    /// @param account Lp to get the unrealized PnL from
    function getLpUnrealizedPnL(uint256 idx, address account) public view override returns (int256) {
        if (!isLpPositionOpen(idx, account)) {
            return 0;
        }

        return clearingHouse.perpetuals(idx).getLpUnrealizedPnL(account);
    }

    /// @param idx Index of the perpetual market
    /// @param account Lp to get the trading fees earned from
    /// @return tradingFeesEarned Trading fees earned by the Liquidity Provider. 18 decimals
    function getLpTradingFees(uint256 idx, address account) public view override returns (uint256) {
        if (!isLpPositionOpen(idx, account)) {
            return 0;
        }

        return clearingHouse.perpetuals(idx).getLpTradingFees(account);
    }

    /// @notice Get the unrealized profit and Loss and the trading fees earned of a  Liquidity Provider
    /// @param  account Lp to get the pnl and trading fees earned from
    /// @return pnl Unrealized profit and loss and trading fees earned. 18 decimals
    function getLpEstimatedPnl(uint256 idx, address account) external view override returns (int256) {
        if (!isLpPositionOpen(idx, account)) {
            return 0;
        }

        return getLpUnrealizedPnL(idx, account) + getLpTradingFees(idx, account).toInt256();
    }

    /// @notice Get the (active) position of a liquidity provider after withdrawing liquidity
    /// @param account Liquidity Provider
    /// @return (Active) Liquidity Provider position
    function getLpPositionAfterWithdrawal(uint256 idx, address account)
        public
        view
        override
        returns (LibPerpetual.TraderPosition memory)
    {
        return clearingHouse.perpetuals(idx).getLpPositionAfterWithdrawal(account);
    }

    /// @notice Get Lp position
    /// @param idx Index of the perpetual market
    /// @param account Address to get the LP position from
    function getLpPosition(uint256 idx, address account)
        external
        view
        override
        returns (LibPerpetual.LiquidityProviderPosition memory)
    {
        return clearingHouse.perpetuals(idx).getLpPosition(account);
    }

    /// @notice Get the current (base) dust balance
    /// @return Base balance of Governance. 18 decimals
    function getBaseDust(uint256 idx) external view override returns (uint256) {
        return int256(getTraderPosition(idx, address(clearingHouse)).positionSize).toUint256();
    }

    /// @notice Get the proposed amount needed to close a position
    /// @dev Solidity implementation to minimize the node calls once has to make when finding proposed amount
    /// @dev Should not be called from another contract
    /// @param idx Index of the perpetual market
    /// @param user Account
    /// @param isTrader Get LP or Trader liquidity provider proposed amount
    /// @param reductionRatio Percentage of the position that the user wishes to close. Min: 0. Max: 1e18
    /// @param iter Maximum iterations
    /// @return amountIn Amount of tokens to swap. 18 decimals
    /// @return amountOut Amount of tokens to receive from the swap. 18 decimals
    function getProposedAmount(
        uint256 idx,
        address user,
        bool isTrader,
        uint256 reductionRatio,
        uint256 iter
    ) external view override returns (uint256 amountIn, uint256 amountOut) {
        int256 positionSize = isTrader
            ? getTraderPosition(idx, user).positionSize
            : getLpPositionAfterWithdrawal(idx, user).positionSize;

        if (reductionRatio > 1e18) revert("Can not reduce by more than 100%");
        int256 targetPositionSize = positionSize.wadMul(reductionRatio.toInt256());

        if (positionSize > 0) {
            amountIn = targetPositionSize.toUint256();
            amountOut = clearingHouse.perpetuals(idx).curveCryptoViews().get_dy_ex_fees(
                getMarket(idx),
                VBASE_INDEX,
                VQUOTE_INDEX,
                amountIn
            );
        } else {
            uint256 position = (-targetPositionSize).toUint256();
            amountIn = position.wadMul(marketPrice(idx));
            // binary search in [marketPrice * 0.7, marketPrice * 1.3]
            uint256 maxVal = (amountIn * 13) / 10;
            uint256 minVal = (amountIn * 7) / 10;

            for (uint256 i = 0; i < iter; i++) {
                amountIn = (minVal + maxVal) / 2;
                amountOut = clearingHouse.perpetuals(idx).curveCryptoViews().get_dy_ex_fees(
                    getMarket(idx),
                    VQUOTE_INDEX,
                    VBASE_INDEX,
                    amountIn
                );

                if (amountOut == position) {
                    break;
                } else if (amountOut < position) {
                    minVal = amountIn;
                } else {
                    maxVal = amountIn;
                }
            }

            // take maxVal to make sure we are above the target
            if (amountOut < position) {
                amountIn = maxVal;
                amountOut = clearingHouse.perpetuals(idx).curveCryptoViews().get_dy_ex_fees(
                    getMarket(idx),
                    VQUOTE_INDEX,
                    VBASE_INDEX,
                    amountIn
                );
            }
        }
        return (amountIn, amountOut);
    }

    /* ******************** */
    /*    Static Helpers    */
    /* ******************** */

    /// @notice ONLY STATIC CALL
    /// @notice Returns base amount of swapping after removing liquidity
    /// @notice Used to estimate proposedAmount for removing liquidity
    /// @param idx Index of the perpetual market
    /// @param liquidityAmountToRemove Amount of liquidity (in LP tokens) to be removed from the pool. 18 decimals
    /// @param minVTokenAmounts Minimum amount of virtual tokens [vQuote, vBase] withdrawn from the curve pool. 18 decimals
    /// @param proposedAmount Amount at which to get the LP position (in vBase if LONG, in vQuote if SHORT). 18 decimals
    /// @return baseProceeds received from swapping after removing liquidity
    function removeLiquiditySwap(
        uint256 idx,
        address user,
        uint256 liquidityAmountToRemove,
        uint256[2] calldata minVTokenAmounts,
        uint256 proposedAmount
    ) external override returns (uint256 baseProceeds) {
        try
            clearingHouse.perpetuals(idx).removeLiquiditySwap(
                user,
                liquidityAmountToRemove,
                minVTokenAmounts,
                proposedAmount
            )
        {
            // slither-disable-next-line uninitialized-local,variable-scope
        } catch (bytes memory errorMessage) {
            // slither-disable-next-line variable-scope
            return abi.decode(errorMessage, (uint256));
        }
    }

    /* ****************** */
    /*   Internal viewer  */
    /* ****************** */
    function _computeMarginRatio(
        int256 collateral,
        int256 unrealizedPositionPnl,
        int256 fundingPayments,
        int256 userDebt
    ) internal pure returns (int256) {
        return (collateral + unrealizedPositionPnl + fundingPayments).wadDiv(userDebt.abs());
    }
}
