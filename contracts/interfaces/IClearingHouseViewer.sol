// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// interfaces
import {IClearingHouse} from "./IClearingHouse.sol";
import {IPerpetual} from "./IPerpetual.sol";
import {IVault} from "./IVault.sol";
import {ICryptoSwap} from "./ICryptoSwap.sol";
import {IInsurance} from "./IInsurance.sol";

// libraries
import {LibPerpetual} from "../lib/LibPerpetual.sol";

interface IClearingHouseViewer {
    /* ****************** */
    /*    Errors          */
    /* ****************** */

    /// @notice Emitted when the zero address is provided as a parameter in the constructor
    error ClearingHouseViewer_ZeroAddressConstructor(uint8 paramIndex);

    /* ****************** */
    /*    Global Getters  */
    /* ****************** */

    function getExpectedVBaseAmount(uint256 idx, uint256 vQuoteAmountToSpend) external view returns (uint256);

    function getExpectedVQuoteAmount(uint256 idx, uint256 vBaseAmountToSpend) external view returns (uint256);

    function marketPrice(uint256 idx) external view returns (uint256);

    function indexPrice(uint256 idx) external view returns (int256);

    function getGlobalPosition(uint256 idx) external view returns (LibPerpetual.GlobalPosition memory);

    function getBaseDust(uint256 idx) external view returns (uint256);

    function getMarket(uint256 idx) external view returns (ICryptoSwap);

    function insuranceFee(uint256 idx) external view returns (int256);

    function getBaseBalance(uint256 idx) external view returns (uint256);

    function getQuoteBalance(uint256 idx) external view returns (uint256);

    function getTotalLiquidityProvided(uint256 idx) external view returns (uint256);

    /* ****************** */
    /*    User Getters    */
    /* ****************** */

    function isMarginValid(address account, int256 ratio) external view returns (bool);

    function marginRatio(address account) external view returns (int256);

    function getFundingPaymentsAcrossMarkets(address account) external view returns (int256 fundingPayments);

    function getReserveValue(address account, bool isDiscounted) external view returns (int256);

    function getBalance(address user, uint256 tokenIdx) external view returns (int256);

    function getTraderFundingPayments(uint256 idx, address account) external view returns (int256);

    function getTraderUnrealizedPnL(uint256 idx, address account) external view returns (int256);

    function getTraderPosition(uint256 idx, address account) external view returns (LibPerpetual.TraderPosition memory);

    function getLpFundingPayments(uint256 idx, address account) external view returns (int256);

    function getLpEstimatedPnl(uint256 idx, address account) external view returns (int256);

    function getLpTradingFees(uint256 idx, address account) external view returns (uint256);

    function getLpUnrealizedPnL(uint256 idx, address account) external view returns (int256);

    function isTraderPositionOpen(uint256 idx, address account) external view returns (bool);

    function isLpPositionOpen(uint256 idx, address account) external view returns (bool);

    function getLpPositionAfterWithdrawal(uint256 idx, address account)
        external
        view
        returns (LibPerpetual.TraderPosition memory);

    function getLpPosition(uint256 idx, address account)
        external
        view
        returns (LibPerpetual.LiquidityProviderPosition memory);

    function getProposedAmount(
        uint256 idx,
        address user,
        bool isTrader,
        uint256 reductionRatio,
        uint256 iter
    ) external view returns (uint256 amountIn, uint256 amountOut);

    /* ******************** */
    /*    Static Helpers    */
    /* ******************** */

    function removeLiquiditySwap(
        uint256 idx,
        address user,
        uint256 liquidityAmountToRemove,
        uint256[2] calldata minVTokenAmounts,
        uint256 proposedAmount
    ) external returns (uint256 baseProceeds);
}
