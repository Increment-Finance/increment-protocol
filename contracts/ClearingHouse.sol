// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// contracts
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IncreAccessControl} from "./utils/IncreAccessControl.sol";

// interfaces
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IClearingHouse} from "./interfaces/IClearingHouse.sol";
import {IPerpetual} from "./interfaces/IPerpetual.sol";
import {IInsurance} from "./interfaces/IInsurance.sol";
import {IVault} from "./interfaces/IVault.sol";
import {ICryptoSwap} from "./interfaces/ICryptoSwap.sol";
import {IStakingContract} from "./interfaces/IStakingContract.sol";

// libraries
import {LibMath} from "./lib/LibMath.sol";
import {LibPerpetual} from "./lib/LibPerpetual.sol";
import {LibReserve} from "./lib/LibReserve.sol";

/// @notice Entry point for users to vault and perpetual markets
contract ClearingHouse is IClearingHouse, IncreAccessControl, Pausable, ReentrancyGuard {
    using LibMath for int256;
    using LibMath for uint256;
    using SafeERC20 for IERC20Metadata;

    // constants
    uint256 internal constant VQUOTE_INDEX = 0; // index of quote asset in curve pool
    uint256 internal constant VBASE_INDEX = 1; // index of base asset in curve pool

    // parameterization

    /// @notice minimum maintenance margin
    int256 public override minMargin;

    /// @notice minimum margin when opening a position
    int256 public override minMarginAtCreation;

    /// @notice minimum positive open notional when opening a position
    uint256 public override minPositiveOpenNotional;

    /// @notice liquidation reward payed to liquidators
    /// @dev Paid on dollar value of an trader position. important: liquidationReward < minMargin or liquidations will result in protocol losses
    uint256 public override liquidationReward;

    /// @notice Insurance ratio
    /// @dev Once the insurance reserve exceed this ratio of the tvl, governance can withdraw exceeding insurance fee
    uint256 public override insuranceRatio;

    /// @notice Portion of the liquidation reward that the insurance gets
    uint256 public override liquidationRewardInsuranceShare;

    /// @notice Discount on the collateral price for the liquidator
    uint256 public override liquidationDiscount;

    /// @notice Discount ratio to be applied on non-UA collaterals before seizing said collaterals for some UA
    /// @dev Must be lower than liquidationDiscount to ensure liquidations don't generate bad debt
    uint256 public override nonUACollSeizureDiscount;

    /// @notice UA debt amount at which non-UA collaterals can be seized to pay back UA debts
    int256 public override uaDebtSeizureThreshold;

    // dependencies

    /// @notice Vault contract
    IVault public override vault;

    /// @notice Insurance contract
    IInsurance public override insurance;

    /// @notice Staking contract
    IStakingContract public override stakingContract;

    /// @notice Allowlisted Perpetual contracts
    IPerpetual[] public override perpetuals;

    constructor(
        IVault _vault,
        IInsurance _insurance,
        ClearingHouseParams memory _params
    ) {
        if (address(_vault) == address(0)) revert ClearingHouse_ZeroAddress();
        if (address(_insurance) == address(0)) revert ClearingHouse_ZeroAddress();

        vault = _vault;
        insurance = _insurance;

        setParameters(_params);
    }

    /* **************************** */
    /*   Collateral operations      */
    /* **************************** */

    /// @notice Deposit tokens into the vault
    /// @param amount Amount to be used as collateral. Might not be 18 decimals
    /// @param token Token to be used for the collateral
    function deposit(uint256 amount, IERC20Metadata token) external override nonReentrant whenNotPaused {
        _deposit(amount, token);
    }

    /// @notice Withdraw tokens from the vault
    /// @param amount Amount of collateral to withdraw. Might not be 18 decimals (decimals of `token`)
    /// @param token Token of the collateral
    function withdraw(uint256 amount, IERC20Metadata token) external override nonReentrant whenNotPaused {
        vault.withdraw(msg.sender, amount, token);

        if (!_isPositionValid(msg.sender, minMarginAtCreation)) revert ClearingHouse_WithdrawInsufficientMargin();
    }

    /// @notice Withdraw all tokens from the vault
    /// @dev Should only be called by the trader
    /// @param token Token of the collateral
    function withdrawAll(IERC20Metadata token) external override nonReentrant whenNotPaused {
        vault.withdrawAll(msg.sender, token);

        if (!_isPositionValid(msg.sender, minMarginAtCreation)) revert ClearingHouse_WithdrawInsufficientMargin();
    }

    /* ****************** */
    /*   Trader flow      */
    /* ****************** */

    /// @notice Open or increase or reduce a position, either LONG or SHORT
    /// @dev No number for the leverage is given but the amount in the vault must be bigger than minMarginAtCreation
    /// @param idx Index of the perpetual market
    /// @param amount Amount in vQuote (if LONG) or vBase (if SHORT) to sell. 18 decimals
    /// @param minAmount Minimum amount that the user is willing to accept. 18 decimals
    /// @param direction Whether the trader wants to go in the LONG or SHORT direction overall
    function changePosition(
        uint256 idx,
        uint256 amount,
        uint256 minAmount,
        LibPerpetual.Side direction
    ) external override nonReentrant whenNotPaused {
        _changePosition(idx, amount, minAmount, direction);
    }

    /// @notice Open a position in the opposite direction of the currently opened position
    /// @notice For example, a trader with a LONG position can switch to a SHORT position with just one call to this function
    /// @param idx Index of the perpetual market
    /// @param closeProposedAmount Amount in vQuote (if LONG) or vBase (if SHORT) to sell to close the position. 18 decimals
    /// @param closeMinAmount Minimum amount that the user is willing to accept when closing the position. 18 decimals
    /// @param openProposedAmount Amount in vQuote (if LONG) or vBase (if SHORT) to sell to open the reversed position. 18 decimals
    /// @param openMinAmount Minimum amount that the user is willing to accept when opening the reversed position. 18 decimals
    /// @param direction Whether the trader wants to go in the LONG or SHORT direction overall
    function openReversePosition(
        uint256 idx,
        uint256 closeProposedAmount,
        uint256 closeMinAmount,
        uint256 openProposedAmount,
        uint256 openMinAmount,
        LibPerpetual.Side direction
    ) external override nonReentrant whenNotPaused {
        _changePosition(idx, closeProposedAmount, closeMinAmount, direction);
        if (perpetuals[idx].isTraderPositionOpen(msg.sender)) revert ClearingHouse_ClosePositionStillOpen();
        _changePosition(idx, openProposedAmount, openMinAmount, direction);
    }

    /// @notice Single open position function, groups depositing collateral and extending position
    /// @param idx Index of the perpetual market
    /// @param collateralAmount Amount to be used as the collateral of the position. Might not be 18 decimals
    /// @param token Token to be used for the collateral of the position
    /// @param positionAmount Amount to be sold, in vQuote (if LONG) or vBase (if SHORT). Must be 18 decimals
    /// @param direction Whether the position is LONG or SHORT
    /// @param minAmount Minimum amount that the user is willing to accept. 18 decimals
    function extendPositionWithCollateral(
        uint256 idx,
        uint256 collateralAmount,
        IERC20Metadata token,
        uint256 positionAmount,
        LibPerpetual.Side direction,
        uint256 minAmount
    ) external override nonReentrant whenNotPaused {
        _deposit(collateralAmount, token);
        _changePosition(idx, positionAmount, minAmount, direction);
    }

    /// @notice Single close position function, groups closing position and withdrawing collateral
    /// @notice Important: `proposedAmount` must be large enough to close the entire position else the function call will fail
    /// @param idx Index of the perpetual market
    /// @param proposedAmount Amount of tokens to be sold, in vBase if LONG, in vQuote if SHORT. 18 decimals
    /// @param minAmount Minimum amount that the user is willing to accept, in vQuote if LONG, in vBase if SHORT. 18 decimals
    /// @param token Token used for the collateral
    function closePositionWithdrawCollateral(
        uint256 idx,
        uint256 proposedAmount,
        uint256 minAmount,
        IERC20Metadata token
    ) external override nonReentrant whenNotPaused {
        int256 traderPositionSize = _getTraderPosition(idx, msg.sender).positionSize;

        LibPerpetual.Side closeDirection = traderPositionSize > 0 ? LibPerpetual.Side.Short : LibPerpetual.Side.Long;

        _changePosition(idx, proposedAmount, minAmount, closeDirection);

        if (perpetuals[idx].isTraderPositionOpen(msg.sender)) revert ClearingHouse_ClosePositionStillOpen();

        // tentatively remove all liquidity of user
        // if user had just one position (trading or LP) in one market, it'll pass, else not
        vault.withdrawAll(msg.sender, token);

        if (!_isPositionValid(msg.sender, minMarginAtCreation)) revert ClearingHouse_WithdrawInsufficientMargin();
    }

    /* ****************** */
    /*  Liquidation flow  */
    /* ****************** */

    /// @notice Submit the address of an user whose position is worth liquidating for a reward
    /// @param idx Index of the perpetual market
    /// @param liquidatee Address of the account to liquidate
    /// @param proposedAmount Amount of tokens to be sold, in vBase if LONG, in vQuote if SHORT. 18 decimals
    /// @param isTrader Whether or not the position to liquidate is a trading position
    function liquidate(
        uint256 idx,
        address liquidatee,
        uint256 proposedAmount,
        bool isTrader
    ) external override nonReentrant whenNotPaused {
        address liquidator = msg.sender;

        _settleUserFundingPayments(liquidatee);

        if (isTrader) {
            if (!perpetuals[idx].isTraderPositionOpen(liquidatee)) revert ClearingHouse_LiquidateInvalidPosition();
        } else {
            if (!perpetuals[idx].isLpPositionOpen(liquidatee)) revert ClearingHouse_LiquidateInvalidPosition();
        }
        if (_isPositionValid(liquidatee, minMargin)) revert ClearingHouse_LiquidateValidMargin();

        (int256 pnl, int256 positiveOpenNotional) = isTrader
            ? _liquidateTrader(idx, liquidatee, proposedAmount)
            : _liquidateLp(idx, liquidatee, proposedAmount);

        // take fee from liquidatee for liquidator and insurance
        uint256 liquidationRewardAmount = positiveOpenNotional.toUint256().wadMul(liquidationReward);
        uint256 insuranceLiquidationReward = liquidationRewardAmount.wadMul(liquidationRewardInsuranceShare);
        uint256 liquidatorLiquidationReward = liquidationRewardAmount - insuranceLiquidationReward;

        vault.settlePnL(liquidatee, pnl - liquidationRewardAmount.toInt256());
        vault.settlePnL(liquidator, liquidatorLiquidationReward.toInt256());
        insurance.fundInsurance(insuranceLiquidationReward);

        emit LiquidationCall(idx, liquidatee, liquidator, positiveOpenNotional.toUint256());
    }

    /// @notice Buy the non-UA collaterals of a user at a discounted UA price to settle the debt of said user
    /// @param liquidatee Address of the account to liquidate
    function seizeCollateral(address liquidatee) external override nonReentrant whenNotPaused {
        address liquidator = msg.sender;

        // all positions must be closed
        uint256 numMarkets = getNumMarkets();
        for (uint256 i = 0; i < numMarkets; ) {
            if (perpetuals[i].isTraderPositionOpen(liquidatee) || perpetuals[i].isLpPositionOpen(liquidatee))
                revert ClearingHouse_SeizeCollateralStillOpen();

            unchecked {
                ++i;
            }
        }

        int256 uaBalance = vault.getBalance(liquidatee, 0);
        int256 discountedCollateralsBalance = vault.getReserveValue(liquidatee, true);
        int256 discountedCollateralsBalanceExUA = discountedCollateralsBalance - uaBalance;

        // user must have UA debt
        if (uaBalance >= 0) revert ClearingHouse_LiquidationDebtSizeZero();

        // for a user to have his non-UA collaterals seized, one of the following 2 conditions must be met:
        // 1) the aggregate value of non-UA collaterals discounted by their weights and the nonUACollSeizureDiscount
        //    ratio must be smaller than his UA debt
        // 2) UA debt must be larger than the threshold defined by uaDebtSeizureThreshold
        if (
            -uaBalance > discountedCollateralsBalanceExUA.wadMul((nonUACollSeizureDiscount).toInt256()) ||
            -uaBalance > uaDebtSeizureThreshold
        ) {
            vault.settleLiquidationOnCollaterals(liquidator, liquidatee);

            emit SeizeCollateral(liquidatee, liquidator);
        } else {
            revert ClearingHouse_SufficientUserCollateral();
        }
    }

    /* ****************** */
    /*   Liquidity flow   */
    /* ****************** */

    /// @notice Provide liquidity to the pool, without depositing new capital in the vault
    /// @param idx Index of the perpetual market
    /// @param amounts Amount of virtual tokens ([vQuote, vBase]) provided. 18 decimals
    /// @param minLpAmount Minimum amount of Lp tokens minted. 18 decimals
    function provideLiquidity(
        uint256 idx,
        uint256[2] calldata amounts,
        uint256 minLpAmount
    ) external override nonReentrant whenNotPaused {
        _provideLiquidity(idx, amounts, minLpAmount);
    }

    /// @notice Remove liquidity from the pool and account profit/loss in UA
    /// @param idx Index of the perpetual market
    /// @param liquidityAmountToRemove Amount of liquidity (in LP tokens) to be removed from the pool. 18 decimals
    /// @param minVTokenAmounts Minimum amount of virtual tokens [vQuote, vBase] to withdraw from the curve pool. 18 decimals
    /// @param proposedAmount Amount at which to sell the active LP position (in vBase if LONG, in vQuote if SHORT). 18 decimals
    /// @param minAmount Minimum amount that the user is willing to accept when closing his active position
    ///        generated after removing liquidity, in vQuote if LONG, in vBase if SHORT. 18 decimals
    function removeLiquidity(
        uint256 idx,
        uint256 liquidityAmountToRemove,
        uint256[2] calldata minVTokenAmounts,
        uint256 proposedAmount,
        uint256 minAmount
    ) external override nonReentrant whenNotPaused {
        _settleUserFundingPayments(msg.sender);

        (int256 profit, uint256 reductionRatio, int256 quoteProceeds) = perpetuals[idx].removeLiquidity(
            msg.sender,
            liquidityAmountToRemove,
            minVTokenAmounts,
            proposedAmount,
            minAmount,
            false
        );

        // pay insurance fee on traded amount
        int256 insuranceFeeAmount = quoteProceeds.abs().wadMul(perpetuals[idx].insuranceFee());
        insurance.fundInsurance(insuranceFeeAmount.toUint256());

        vault.settlePnL(msg.sender, profit - insuranceFeeAmount);

        _isOpenNotionalRequirementValid(idx, msg.sender, false);
        emit LiquidityRemoved(idx, msg.sender, reductionRatio);
    }

    /* ****************** */
    /*     Governance     */
    /* ****************** */

    /// @notice Sell dust of a given market
    /// @dev Can only be called by Manager
    /// @param idx Index of the perpetual market to sell dust from
    /// @param proposedAmount Amount of tokens to be sold, in vBase if LONG, in vQuote if SHORT. 18 decimals
    /// @param minAmount Minimum amount that the user is willing to accept, in vQuote if LONG, in vBase if SHORT. 18 decimals
    function sellDust(
        uint256 idx,
        uint256 proposedAmount,
        uint256 minAmount
    ) external override nonReentrant onlyRole(MANAGER) {
        (, , int256 profit, ) = perpetuals[idx].changePosition(
            address(this),
            proposedAmount,
            minAmount,
            LibPerpetual.Side.Short,
            false
        );

        // no Vault balance to reduce because the positions where dust have been taken out
        // have already been reduced (see `Perpetual._donate`)
        insurance.fundInsurance(profit.toUint256());

        emit DustSold(idx, profit);
    }

    /// @notice Pause the contract
    /// @dev Can only be called by Manager
    function pause() external override onlyRole(MANAGER) {
        _pause();
    }

    /// @notice Unpause the contract
    /// @dev Can only be called by Manager
    function unpause() external override onlyRole(MANAGER) {
        _unpause();
    }

    /// @notice Add one perpetual market to the list of markets
    /// @param perp Market to add to the list of supported market
    function allowListPerpetual(IPerpetual perp) external override onlyRole(GOVERNANCE) {
        if (address(perp) == address(0)) revert ClearingHouse_ZeroAddress();

        for (uint256 i = 0; i < getNumMarkets(); i++) {
            if (perpetuals[i] == perp) revert ClearingHouse_PerpetualMarketAlreadyAssigned();
        }

        perpetuals.push(perp);
        emit MarketAdded(perp, perpetuals.length);
    }

    /// @notice Add a staking contract
    /// @dev Staking contract is not implemented yet
    /// @param staking Staking Contract
    function addStakingContract(IStakingContract staking) external override onlyRole(GOVERNANCE) {
        if (address(staking) == address(0)) revert ClearingHouse_ZeroAddress();
        stakingContract = staking;

        emit StakingContractChanged(staking);
    }

    /// @notice Update the value of the param listed in `IClearingHouse.ClearingHouseParams`
    /// @param params New economic parameters
    function setParameters(ClearingHouseParams memory params) public override onlyRole(GOVERNANCE) {
        if (params.minMargin < 2e16 || params.minMargin > 2e17) revert ClearingHouse_InvalidMinMargin();
        if (params.minMarginAtCreation <= params.minMargin || params.minMarginAtCreation > 5e17)
            revert ClearingHouse_InvalidMinMarginAtCreation();
        if (params.minPositiveOpenNotional > 1000 * 1e18) revert ClearingHouse_ExcessivePositiveOpenNotional();
        if (params.liquidationReward < 1e16 || params.liquidationReward >= params.minMargin.toUint256())
            revert ClearingHouse_InvalidLiquidationReward();
        if (params.liquidationDiscount < 7e17) revert ClearingHouse_ExcessiveLiquidationDiscount();
        if (params.nonUACollSeizureDiscount + 1e17 > params.liquidationDiscount)
            revert ClearingHouse_InsufficientDiffBtwLiquidationDiscountAndNonUACollSeizureDiscount(); // even with an assets with a weight of 1 the nonUACollateralSeizeDiscount should be less than the liquidationDiscount
        if (params.uaDebtSeizureThreshold < 1e20) revert ClearingHouse_InsufficientUaDebtSeizureThreshold();
        if (params.insuranceRatio < 1e17 || params.insuranceRatio > 5e17) revert ClearingHouse_InvalidInsuranceRatio();
        if (params.liquidationRewardInsuranceShare > 1e18)
            revert ClearingHouse_ExcessiveLiquidationRewardInsuranceShare();

        minMargin = params.minMargin;
        minPositiveOpenNotional = params.minPositiveOpenNotional;
        liquidationReward = params.liquidationReward;
        liquidationDiscount = params.liquidationDiscount;
        nonUACollSeizureDiscount = params.nonUACollSeizureDiscount;
        uaDebtSeizureThreshold = params.uaDebtSeizureThreshold;
        insuranceRatio = params.insuranceRatio;
        minMarginAtCreation = params.minMarginAtCreation;
        liquidationRewardInsuranceShare = params.liquidationRewardInsuranceShare;

        emit ClearingHouseParametersChanged(
            params.minMargin,
            params.minMarginAtCreation,
            params.minPositiveOpenNotional,
            params.liquidationReward,
            params.insuranceRatio,
            params.liquidationRewardInsuranceShare,
            params.liquidationDiscount,
            params.nonUACollSeizureDiscount,
            params.uaDebtSeizureThreshold
        );
    }

    /* ****************** */
    /*   Market viewer    */
    /* ****************** */

    /// @notice Return the number of active markets
    function getNumMarkets() public view override returns (uint256) {
        return perpetuals.length;
    }

    /* ****************** */
    /*   User viewer      */
    /* ****************** */

    /// @notice Get user profit/loss across all perpetual markets
    /// @param account User address (trader and/or liquidity provider)
    function getPnLAcrossMarkets(address account) public view override returns (int256 unrealizedPositionPnl) {
        uint256 numMarkets = getNumMarkets();
        for (uint256 i = 0; i < numMarkets; ) {
            unrealizedPositionPnl += perpetuals[i].getPendingPnL(account);

            unchecked {
                ++i;
            }
        }
    }

    /// @notice Get user debt across all perpetual markets
    /// @param account User address (trader and/or liquidity provider)
    function getDebtAcrossMarkets(address account) public view override returns (int256 userDebt) {
        uint256 numMarkets = getNumMarkets();
        for (uint256 i = 0; i < numMarkets; ) {
            uint256 weight = perpetuals[i].riskWeight();
            userDebt += perpetuals[i].getUserDebt(account).wadMul(weight.toInt256());

            unchecked {
                ++i;
            }
        }
    }

    /// @notice Get the margin required to serve user debt at a chosen margin ratio
    /// @param account User address (trader and/or liquidity provider)
    /// @param ratio Margin ratio (minMargin or minMarginAtCreation)
    function getTotalMarginRequirement(address account, int256 ratio) public view returns (int256 requiredMargin) {
        int256 userDebt = getDebtAcrossMarkets(account);
        /*
            From the margin ratio formula we know:
            margin / userDebt = ratio

            So we can compute the required margin as:
            margin = userDebt * ratio
        */
        return userDebt.wadMul(ratio);
    }

    /// @notice Get free collateral of a user given a chosen margin ratio
    /// @param account User address (trader and/or liquidity provider)
    /// @param ratio Margin ratio (minMargin or minMarginAtCreation)
    function getFreeCollateralByRatio(address account, int256 ratio) public view returns (int256 freeCollateral) {
        int256 pnl = getPnLAcrossMarkets(account);
        int256 reserveValue = _getReserveValue(account, true);
        int256 marginRequired = getTotalMarginRequirement(account, ratio);

        // We define freeCollateral as follows:
        // freeCollateral = min(totalCollateralValue, totalCollateralValue + pnl) - marginRequired)
        // This is a conservative approach when compared to
        // freeCollateral = totalCollateralValue + pnl - marginRequired
        // since the unrealized pnl depends on the index price
        // where a deviation could allow a trader to empty the vault

        return reserveValue.min(reserveValue + pnl) - marginRequired;
    }

    /* ****************** */
    /*   Internal user    */
    /* ****************** */

    function _liquidateTrader(
        uint256 idx,
        address liquidatee,
        uint256 proposedAmount
    ) internal returns (int256 pnL, int256 positiveOpenNotional) {
        (positiveOpenNotional) = int256(_getTraderPosition(idx, liquidatee).openNotional).abs();

        LibPerpetual.Side closeDirection = _getTraderPosition(idx, liquidatee).positionSize >= 0
            ? LibPerpetual.Side.Short
            : LibPerpetual.Side.Long;

        // (liquidatee, proposedAmount)
        (, , pnL, ) = perpetuals[idx].changePosition(liquidatee, proposedAmount, 0, closeDirection, true);

        // traders are allowed to reduce their positions partially, but liquidators have to close positions in full
        if (perpetuals[idx].isTraderPositionOpen(liquidatee))
            revert ClearingHouse_LiquidateInsufficientProposedAmount();

        return (pnL, positiveOpenNotional);
    }

    function _liquidateLp(
        uint256 idx,
        address liquidatee,
        uint256 proposedAmount
    ) internal returns (int256 pnL, int256 positiveOpenNotional) {
        positiveOpenNotional = _getLpOpenNotional(idx, liquidatee).abs();

        // close lp
        (pnL, , ) = perpetuals[idx].removeLiquidity(
            liquidatee,
            _getLpLiquidity(idx, liquidatee),
            [uint256(0), uint256(0)],
            proposedAmount,
            0,
            true
        );
        _distributeLpRewards(idx, liquidatee);

        return (pnL, positiveOpenNotional);
    }

    function _deposit(uint256 amount, IERC20Metadata token) internal {
        vault.deposit(msg.sender, amount, token);
    }

    function _changePosition(
        uint256 idx,
        uint256 amount,
        uint256 minAmount,
        LibPerpetual.Side direction
    ) internal {
        if (amount == 0) revert ClearingHouse_ChangePositionZeroAmount();

        _settleUserFundingPayments(msg.sender);

        (int256 quoteProceeds, int256 baseProceeds, int256 profit, bool isPositionIncreased) = perpetuals[idx]
            .changePosition(msg.sender, amount, minAmount, direction, false);

        // pay insurance fee
        int256 insuranceFeeAmount = 0;
        if (isPositionIncreased) {
            insuranceFeeAmount = quoteProceeds.abs().wadMul(perpetuals[idx].insuranceFee());
            insurance.fundInsurance(insuranceFeeAmount.toUint256());
        }

        int256 traderVaultDiff = profit - insuranceFeeAmount;
        vault.settlePnL(msg.sender, traderVaultDiff);

        if (!_isPositionValid(msg.sender, minMarginAtCreation)) revert ClearingHouse_ExtendPositionInsufficientMargin();
        if (!_isOpenNotionalRequirementValid(idx, msg.sender, true))
            revert ClearingHouse_UnderOpenNotionalAmountRequired();

        emit ChangePosition(
            idx,
            msg.sender,
            direction,
            quoteProceeds,
            baseProceeds,
            traderVaultDiff,
            isPositionIncreased
        );
    }

    function _provideLiquidity(
        uint256 idx,
        uint256[2] calldata amounts,
        uint256 minLpAmount
    ) internal {
        if (amounts[VQUOTE_INDEX] == 0 && amounts[VBASE_INDEX] == 0) revert ClearingHouse_ProvideLiquidityZeroAmount();

        _settleUserFundingPayments(msg.sender);

        // check enough free collateral
        int256 freeCollateralUSD = getFreeCollateralByRatio(msg.sender, minMarginAtCreation);

        // compare the dollar value of quantities q1 & q2 with the free collateral
        // allow to provide liquidity with 2x leverage
        if (
            amounts[VQUOTE_INDEX].toInt256() + amounts[VBASE_INDEX].toInt256().wadMul(perpetuals[idx].indexPrice()) >
            2 * freeCollateralUSD
        ) revert ClearingHouse_AmountProvidedTooLarge();

        int256 tradingFees = perpetuals[idx].provideLiquidity(msg.sender, amounts, minLpAmount);
        if (tradingFees != 0) vault.settlePnL(msg.sender, tradingFees);

        _distributeLpRewards(idx, msg.sender);

        _isOpenNotionalRequirementValid(idx, msg.sender, false);
        _isPositionValid(msg.sender, minMarginAtCreation);

        emit LiquidityProvided(idx, msg.sender, amounts[VQUOTE_INDEX], amounts[VBASE_INDEX]);
    }

    /// @notice Settle funding payments of a user across all markets, on trading and liquidity positions
    function _settleUserFundingPayments(address account) internal {
        int256 fundingPayments;
        uint256 numMarkets = getNumMarkets();
        for (uint256 i = 0; i < numMarkets; ) {
            fundingPayments += perpetuals[i].settleTrader(account) + perpetuals[i].settleLp(account);

            unchecked {
                ++i;
            }
        }

        if (fundingPayments != 0) {
            vault.settlePnL(account, fundingPayments);
        }
    }

    /// @notice Distribute LP staking rewards
    function _distributeLpRewards(uint256 idx, address lp) internal {
        if (address(stakingContract) != address(0)) stakingContract.updateStakingPosition(idx, lp);
    }

    /* ****************** */
    /*   Internal getter  */
    /* ****************** */

    function _isOpenNotionalRequirementValid(
        uint256 idx,
        address account,
        bool isTrader
    ) internal view returns (bool) {
        int256 openNotional = isTrader
            ? _getTraderPosition(idx, account).openNotional
            : _getLpOpenNotional(idx, account);
        uint256 absOpenNotional = openNotional.abs().toUint256();

        // we don't want the check to fail if the position has been closed (e.g. in `reducePosition`)
        if (absOpenNotional > 0) {
            return absOpenNotional > minPositiveOpenNotional;
        }

        return true;
    }

    function _isPositionValid(address account, int256 ratio) internal view returns (bool) {
        return getFreeCollateralByRatio(account, ratio) >= 0;
    }

    function _getReserveValue(address account, bool isDiscounted) internal view returns (int256) {
        return vault.getReserveValue(account, isDiscounted);
    }

    function _getTraderPosition(uint256 idx, address account)
        internal
        view
        returns (LibPerpetual.TraderPosition memory)
    {
        return perpetuals[idx].getTraderPosition(account);
    }

    function _getLpLiquidity(uint256 idx, address account) internal view returns (uint256) {
        return perpetuals[idx].getLpLiquidity(account);
    }

    function _getLpOpenNotional(uint256 idx, address account) internal view returns (int256) {
        return perpetuals[idx].getLpOpenNotional(account);
    }
}
