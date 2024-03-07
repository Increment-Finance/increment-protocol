// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// contracts
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IncreAccessControl} from "./utils/IncreAccessControl.sol";

// interfaces
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IInsurance} from "./interfaces/IInsurance.sol";
import {IOracle} from "./interfaces/IOracle.sol";
import {IVault} from "./interfaces/IVault.sol";
import {IClearingHouse} from "./interfaces/IClearingHouse.sol";

// libraries
import {LibReserve} from "./lib/LibReserve.sol";
import {LibMath} from "./lib/LibMath.sol";

/// @notice Keeps track of all token reserves for all market
contract Vault is IVault, IncreAccessControl {
    using SafeERC20 for IERC20Metadata;
    using LibMath for uint256;
    using LibMath for int256;

    // constants
    // slither-disable-next-line naming-convention
    IERC20Metadata public immutable override UA;
    uint256 public constant UA_IDX = 0;

    // dependencies
    IClearingHouse public override clearingHouse;
    IInsurance public override insurance;
    IOracle public override oracle;

    // global state
    Collateral[] internal whiteListedCollaterals;
    /// @notice Map white listed collateral tokens to their whiteListedCollaterals indexes
    mapping(IERC20Metadata => uint256) public override tokenToCollateralIdx;

    // user state

    /* Balances of users and liquidity providers

    */
    //       user  =>    collateralIdx => balance (might not be 18 decimals)
    mapping(address => mapping(uint256 => int256)) private balances;

    constructor(IERC20Metadata _ua) {
        if (address(_ua) == address(0)) revert Vault_ZeroAddressConstructor(0);

        UA = _ua;
        addWhiteListedCollateral(_ua, 1e18, type(uint256).max);
    }

    modifier onlyClearingHouse() {
        if (msg.sender != address(clearingHouse)) revert Vault_SenderNotClearingHouse();
        _;
    }

    modifier onlyClearingHouseOrInsurance() {
        if (msg.sender != address(clearingHouse) && msg.sender != address(insurance))
            revert Vault_SenderNotClearingHouseNorInsurance();
        _;
    }

    /* ****************** */
    /*     User flow      */
    /* ****************** */

    /// @notice Add an amount of a whitelisted token to the balance of a user
    /// @param user Account to deposit collateral to
    /// @param amount Amount to be used as the collateral of the position. Might not be 18 decimals (decimals of the token)
    /// @param depositToken One whitelisted token
    function deposit(
        address user,
        uint256 amount,
        IERC20Metadata depositToken
    ) external override onlyClearingHouse {
        return _deposit(user, amount, depositToken);
    }

    /// @notice Withdraw all tokens stored by a user in the vault
    /// @param user Account to withdraw from
    /// @param withdrawToken Token whose balance is to be withdrawn from the vault
    function withdrawAll(address user, IERC20Metadata withdrawToken) external override onlyClearingHouse {
        uint256 tokenIdx = tokenToCollateralIdx[withdrawToken];
        if (!((tokenIdx != 0) || (address(withdrawToken) == address(UA)))) revert Vault_UnsupportedCollateral();

        int256 fullAmount = balances[user][tokenIdx];

        return _withdraw(user, fullAmount.toUint256(), withdrawToken);
    }

    /// @notice Withdraw tokens stored by a user in the vault
    /// @dev Unlike `deposit`, `withdraw` treats withdrawals of UA differently than other collaterals
    /// @param user Account to withdraw from
    /// @param amount Amount to withdraw from the vault. Might not be 18 decimals (decimals of the token)
    /// @param withdrawToken Token whose balance is to be withdrawn from the vault
    function withdraw(
        address user,
        uint256 amount,
        IERC20Metadata withdrawToken
    ) external override onlyClearingHouse {
        uint256 tokenIdx = tokenToCollateralIdx[withdrawToken];
        if (!((tokenIdx != 0) || (address(withdrawToken) == address(UA)))) revert Vault_UnsupportedCollateral();

        uint256 tokenAmount = LibReserve.tokenToWad(whiteListedCollaterals[tokenIdx].decimals, amount);
        _withdraw(user, tokenAmount, withdrawToken);
    }

    /// @notice Allow liquidator to buy back non-UA collateral(s) of liquidated user at a discounted price whereby settling the latter debt
    /// @dev The liquidator buys just as much non-UA collaterals to cover the liquidatee's debt, not more
    /// @dev If the USD value of all the non-UA collaterals of the liquidatee < his UA debt, Increment insurance steps in to cover the remainder of the UA debt
    /// @param liquidator Address of the liquidator
    /// @param liquidatee Address of the liquidatee
    function settleLiquidationOnCollaterals(address liquidator, address liquidatee)
        external
        override
        onlyClearingHouse
    {
        int256 balance = balances[liquidatee][UA_IDX];

        uint256 debtSize = (-balance).toUint256();

        Collateral[] storage collaterals = whiteListedCollaterals;
        int256 collateralBalance;

        // we only liquidate users who have a UA debt
        uint256 numCollaterals = collaterals.length;
        for (uint256 i = 1; i < numCollaterals; ) {
            collateralBalance = balances[liquidatee][i];

            if (collateralBalance > 0) {
                // take the discounted value
                uint256 collateralLiquidationValue = (
                    _getUndiscountedCollateralUSDValue(collaterals[i].asset, collateralBalance).toUint256()
                ).wadMul(clearingHouse.liquidationDiscount());

                if (collateralLiquidationValue < debtSize) {
                    // sell 100% of the collateral
                    debtSize -= _sellCollateral(
                        liquidator,
                        liquidatee,
                        collaterals[i],
                        collateralBalance.toUint256(),
                        collateralLiquidationValue // uaDebtSettled
                    );
                } else {
                    // sell only what is needed of the collateral to cover debtSize
                    uint256 collateralSellRatio = debtSize.wadDiv(collateralLiquidationValue);
                    uint256 collateralAmountToSell = (collateralBalance.wadMul(collateralSellRatio.toInt256()))
                        .toUint256();

                    _sellCollateral(liquidator, liquidatee, collaterals[i], collateralAmountToSell, debtSize);
                    debtSize = 0;

                    break;
                }
            }

            unchecked {
                i++;
            }
        }

        // if combined USD value of the liquidatee collaterals < his debtSize,
        // Insurance must step in to maintain solvency of the Vault
        if (debtSize > 0) {
            insurance.settleDebt(debtSize);
            _changeBalance(liquidatee, UA_IDX, debtSize.toInt256());

            emit TraderBadDebtGenerated(liquidatee, debtSize);
        }
    }

    /// @notice Settle PnL for user in UA
    /// @param user Account to apply the PnL to
    /// @param amount PnL amount in UA to apply. 18 decimals
    function settlePnL(address user, int256 amount) external override onlyClearingHouse {
        _changeBalance(user, UA_IDX, amount);
    }

    /// @notice Transfer UA tokens from the vault
    /// @dev Important: the balance of the user from whom the UA tokens are being withdrawn must be updated separately
    /// @param user Account to withdraw UA tokens to
    /// @param amount Amount of UA tokens to be withdrawn. 18 decimals
    function transferUa(address user, uint256 amount) external override onlyClearingHouseOrInsurance {
        whiteListedCollaterals[UA_IDX].currentAmount -= amount;
        UA.safeTransfer(user, amount);
    }

    /* ****************** */
    /*     Governance     */
    /* ****************** */

    /// @notice Update the ClearingHouse address
    /// @param newClearingHouse Address of the new ClearingHouse
    function setClearingHouse(IClearingHouse newClearingHouse) external override onlyRole(GOVERNANCE) {
        if (address(newClearingHouse) == address(0)) revert Vault_ClearingHouseZeroAddress();
        clearingHouse = newClearingHouse;
        emit ClearingHouseChanged(newClearingHouse);
    }

    /// @notice Update the Insurance address
    /// @param newInsurance Address of the new Insurance
    function setInsurance(IInsurance newInsurance) external override onlyRole(GOVERNANCE) {
        if (address(newInsurance) == address(0)) revert Vault_InsuranceZeroAddress();
        insurance = newInsurance;
        emit InsuranceChanged(newInsurance);
    }

    /// @notice Update the Oracle address
    /// @param newOracle Address of the new Oracle
    function setOracle(IOracle newOracle) external override onlyRole(GOVERNANCE) {
        if (address(newOracle) == address(0)) revert Vault_OracleZeroAddress();
        oracle = newOracle;
        emit OracleChanged(newOracle);
    }

    /// @notice Add a new token to the list of whitelisted ERC20 which can be used as collaterals
    /// @param asset Address of the token to be whitelisted as a valid collateral in the Vault
    /// @param weight Discount weight to be applied on the asset vault
    /// @param maxAmount Maximum total amount that the Vault will accept of this collateral
    function addWhiteListedCollateral(
        IERC20Metadata asset,
        uint256 weight,
        uint256 maxAmount
    ) public override onlyRole(GOVERNANCE) {
        if (weight < 1e17) revert Vault_InsufficientCollateralWeight();
        if (weight > 1e18) revert Vault_ExcessiveCollateralWeight();

        for (uint256 i = 0; i < whiteListedCollaterals.length; i++) {
            if (whiteListedCollaterals[i].asset == asset) revert Vault_CollateralAlreadyWhiteListed();
        }

        whiteListedCollaterals.push(
            Collateral({
                asset: asset,
                weight: weight,
                decimals: asset.decimals(),
                currentAmount: 0,
                maxAmount: maxAmount
            })
        );
        tokenToCollateralIdx[asset] = whiteListedCollaterals.length - 1;

        emit CollateralAdded(asset, weight, maxAmount);
    }

    /// @notice Change weight of a white listed collateral
    ///         Useful as a risk mitigation measure in case one collateral drops in value
    /// @param asset Address of asset to change collateral weight
    /// @param newWeight New weight. 18 decimals
    function changeCollateralWeight(IERC20Metadata asset, uint256 newWeight) external override onlyRole(GOVERNANCE) {
        uint256 tokenIdx = tokenToCollateralIdx[asset];
        if (!((tokenIdx != 0) || (address(asset) == address(UA)))) revert Vault_UnsupportedCollateral();

        if (newWeight < 1e16) revert Vault_InsufficientCollateralWeight();
        if (newWeight > 1e18) revert Vault_ExcessiveCollateralWeight();

        whiteListedCollaterals[tokenIdx].weight = newWeight;

        emit CollateralWeightChanged(asset, newWeight);
    }

    /// @notice Change max amount of a white listed collateral
    ///         Useful as a risk mitigation measure in case one collateral drops in value
    /// @param asset Address of asset to change max amount
    /// @param newMaxAmount New max amount for the collateral
    function changeCollateralMaxAmount(IERC20Metadata asset, uint256 newMaxAmount)
        external
        override
        onlyRole(GOVERNANCE)
    {
        uint256 tokenIdx = tokenToCollateralIdx[asset];
        if (!((tokenIdx != 0) || (address(asset) == address(UA)))) revert Vault_UnsupportedCollateral();

        whiteListedCollaterals[tokenIdx].maxAmount = newMaxAmount;

        emit CollateralMaxAmountChanged(asset, newMaxAmount);
    }

    /* ****************** */
    /*   User getter      */
    /* ****************** */

    /// @notice Get the balance of a user, accounted for in USD. 18 decimals
    /// @param user User address
    /// @param isDiscounted Whether or not the reserve value should be discounted by the weight of the collateral
    function getReserveValue(address user, bool isDiscounted) external view override returns (int256) {
        return _getUserReserveValue(user, isDiscounted);
    }

    /// @notice Get the balance of a user of a given token
    /// @param user User address
    /// @param tokenIdx Index of the token
    function getBalance(address user, uint256 tokenIdx) external view override returns (int256) {
        return balances[user][tokenIdx];
    }

    /* ****************** */
    /*   Global getter    */
    /* ****************** */

    /// @notice Get total value of all tokens deposited in the vault, in USD. 18 decimals
    function getTotalValueLocked() external view override returns (int256) {
        Collateral[] storage collaterals = whiteListedCollaterals;
        int256 tvl = 0;

        uint256 numCollaterals = collaterals.length;
        for (uint256 i = 0; i < numCollaterals; ) {
            int256 collateralBalance = collaterals[i].currentAmount.toInt256();

            if (collateralBalance > 0) {
                tvl += _getUndiscountedCollateralUSDValue(collaterals[i].asset, collateralBalance);
            }

            unchecked {
                i++;
            }
        }

        return tvl;
    }

    /// @notice Get details of a whitelisted collateral token
    /// @param idx Index of the whitelisted collateral to get details from
    function getWhiteListedCollateral(uint256 idx) external view override returns (Collateral memory) {
        return whiteListedCollaterals[idx];
    }

    /// @notice Get number of whitelisted tokens
    function getNumberOfCollaterals() external view override returns (uint256) {
        return whiteListedCollaterals.length;
    }

    /* ****************** */
    /*   Internal Fcts    */
    /* ****************** */

    function _deposit(
        address user,
        uint256 amount,
        IERC20Metadata depositToken
    ) internal {
        uint256 tokenIdx = tokenToCollateralIdx[depositToken];
        if (!((tokenIdx != 0) || (address(depositToken) == address(UA)))) revert Vault_UnsupportedCollateral();

        Collateral storage coll = whiteListedCollaterals[tokenIdx];
        uint256 wadAmount = LibReserve.tokenToWad(coll.decimals, amount);

        if (coll.currentAmount + wadAmount > coll.maxAmount) revert Vault_MaxCollateralAmountExceeded();
        whiteListedCollaterals[tokenIdx].currentAmount += wadAmount;

        _changeBalance(user, tokenIdx, wadAmount.toInt256());

        IERC20Metadata(depositToken).safeTransferFrom(user, address(this), amount);

        emit Deposit(user, address(depositToken), amount);
    }

    function _withdraw(
        address user,
        uint256 amount, // 1e18
        IERC20Metadata withdrawToken
    ) internal {
        uint256 tokenIdx = tokenToCollateralIdx[withdrawToken];
        if (!((tokenIdx != 0) || (address(withdrawToken) == address(UA)))) revert Vault_UnsupportedCollateral();

        // user can't withdraw his collateral with a UA debt
        int256 uaBalance = balances[user][UA_IDX];
        if (uaBalance < 0) revert Vault_UADebt();

        // user can't withdraw more than his collateral balance
        int256 collateralBalance = balances[user][tokenIdx];
        if (amount.toInt256() > collateralBalance) revert Vault_WithdrawExcessiveAmount();

        if (amount > whiteListedCollaterals[tokenIdx].currentAmount) revert Vault_InsufficientBalance();
        whiteListedCollaterals[tokenIdx].currentAmount -= amount;
        _changeBalance(user, tokenIdx, -amount.toInt256());

        uint256 tokenAmount = LibReserve.wadToToken(whiteListedCollaterals[tokenIdx].decimals, amount);

        // transfer funds to user, whatever the collateral used
        IERC20Metadata(withdrawToken).safeTransfer(user, tokenAmount);
        emit Withdraw(user, address(withdrawToken), tokenAmount);
    }

    /// @notice Sell liquidatee collateral at a discount to a liquidator willing to buy it in UA
    /// @param liquidator Liquidator
    /// @param liquidatee Liquidatee
    /// @param collateral Collateral to be sold
    /// @param collateralAmountToSell Collateral amount to be sold
    /// @param uaDebtSettled UA amount at which to buy the collateral
    function _sellCollateral(
        address liquidator,
        address liquidatee,
        Collateral storage collateral,
        uint256 collateralAmountToSell,
        uint256 uaDebtSettled
    ) internal returns (uint256) {
        // liquidatee receives a discounted value of his collateral in UA
        _changeBalance(liquidatee, UA_IDX, uaDebtSettled.toInt256());
        _changeBalance(liquidatee, tokenToCollateralIdx[collateral.asset], -collateralAmountToSell.toInt256());

        // liquidator receives the real value of the collateral
        IERC20Metadata(UA).safeTransferFrom(liquidator, address(this), uaDebtSettled);
        _changeBalance(liquidator, tokenToCollateralIdx[collateral.asset], collateralAmountToSell.toInt256());

        return uaDebtSettled;
    }

    function _changeBalance(
        address user,
        uint256 tokenIdx,
        int256 amount
    ) internal {
        balances[user][tokenIdx] += amount;
    }

    /// @notice Get the full collateral value of a trader, accounted for in USD. 18 decimals
    /// @dev Discount collateral when evaluating the value of a collateral. Don't discount when selling the collateral.
    /// @param user User address
    /// @param isDiscounted Whether or not the collateral value should be discounted by its weight
    function _getUserReserveValue(address user, bool isDiscounted) internal view returns (int256) {
        Collateral[] storage collaterals = whiteListedCollaterals;
        int256 collateralBalance;

        int256 reserveValue = 0;
        uint256 numCollaterals = collaterals.length;
        for (uint256 i = 0; i < numCollaterals; ) {
            collateralBalance = balances[user][i];

            // user might have a negative UA balance
            if (collateralBalance != 0) {
                if (isDiscounted) {
                    reserveValue += _getDiscountedCollateralUSDValue(
                        collaterals[i].asset,
                        collaterals[i].weight,
                        collateralBalance
                    );
                } else {
                    reserveValue += _getUndiscountedCollateralUSDValue(collaterals[i].asset, collateralBalance);
                }
            }

            unchecked {
                i++;
            }
        }

        return reserveValue;
    }

    /// @notice Return collateral value in USD discounted by its weight, normalized to 18 decimals
    /// @param collateralAsset Collateral asset to evaluate
    /// @param collateralWeight Weight of the collateral to evaluate
    /// @param collateralBalance Balance in the collateral. 18 decimals
    function _getDiscountedCollateralUSDValue(
        IERC20Metadata collateralAsset,
        uint256 collateralWeight,
        int256 collateralBalance
    ) internal view returns (int256) {
        // collateralUSDValue = collateralBalance * weight * oracleUSDPrice
        int256 weightedCollateralBalance = collateralBalance.wadMul(collateralWeight.toInt256());

        // `collateralBalance` is only being used by `getPrice` if `collateralAsset` is a ERC-4626 token
        int256 usdPricePerUnit = oracle.getPrice(address(collateralAsset), collateralBalance);

        return weightedCollateralBalance.wadMul(usdPricePerUnit);
    }

    /// @notice Get the undiscounted USD price of a collateral
    /// @dev As a reminder, USD value = UA value
    /// @dev Same as _getDiscountedCollateralUSDValue, except without weight (without discount)
    /// @param collateralAsset Collateral asset to evaluate
    /// @param collateralBalance Balance in the collateral. 18 decimals
    function _getUndiscountedCollateralUSDValue(IERC20Metadata collateralAsset, int256 collateralBalance)
        internal
        view
        returns (int256)
    {
        // collateralBalance is only being used by `getPrice` if `collateralAsset` is a ERC-4626 token
        int256 usdPricePerUnit = oracle.getPrice(address(collateralAsset), collateralBalance);

        return collateralBalance.wadMul(usdPricePerUnit);
    }
}
