import {keccak256, toUtf8Bytes} from 'ethers/lib/utils';
import {tEthereumAddress} from './types';

export enum ClearingHouseErrors {
  ZeroAddress = 'ClearingHouse_ZeroAddress',
  WithdrawInsufficientMargin = 'ClearingHouse_WithdrawInsufficientMargin',
  ClosePositionStillOpen = 'ClearingHouse_ClosePositionStillOpen',
  LiquidateInvalidPosition = 'ClearingHouse_LiquidateInvalidPosition',
  LiquidateValidMargin = 'ClearingHouse_LiquidateValidMargin',
  LiquidateInsufficientProposedAmount = 'ClearingHouse_LiquidateInsufficientProposedAmount',
  SeizeCollateralStillOpen = 'ClearingHouse_SeizeCollateralStillOpen',
  ProviderLiquidityZeroAmount = 'ClearingHouse_ProvideLiquidityZeroAmount',
  AmountProvidedTooLarge = 'ClearingHouse_AmountProvidedTooLarge',
  RemoveLiquidityInsufficientFunds = 'ClearingHouse_RemoveLiquidityInsufficientFunds',
  VaultWithdrawUnsuccessful = 'ClearingHouse_VaultWithdrawUnsuccessful',
  ExcessiveLiquidationRewardInsuranceShare = 'ClearingHouse_ExcessiveLiquidationRewardInsuranceShare',
  ExtendPositionZeroAmount = 'ClearingHouse_ExtendPositionZeroAmount',
  ExtendPositionInsufficientMargin = 'ClearingHouse_ExtendPositionInsufficientMargin',
  ReducePositionZeroAmount = 'ClearingHouse_ReducePositionZeroAmount',
  ChangePositionZeroArgument = 'ClearingHouse_ChangePositionZeroAmount',
  UnderOpenNotionalAmountRequired = 'ClearingHouse_UnderOpenNotionalAmountRequired',
  PerpetualMarketAlreadyAssigned = 'ClearingHouse_PerpetualMarketAlreadyAssigned',
  LiquidationDebtSizeZero = 'ClearingHouse_LiquidationDebtSizeZero',
  SufficientUserCollateral = 'ClearingHouse_SufficientUserCollateral',
  InvalidMinMargin = 'ClearingHouse_InvalidMinMargin',
  InvalidMinMarginAtCreation = 'ClearingHouse_InvalidMinMarginAtCreation',
  ExcessivePositiveOpenNotional = 'ClearingHouse_ExcessivePositiveOpenNotional',
  InvalidLiquidationReward = 'ClearingHouse_InvalidLiquidationReward',
  InvalidInsuranceRatio = 'ClearingHouse_InvalidInsuranceRatio',
  InsufficientDiffBtwLiquidationDiscountAndNonUACollSeizureDiscount = 'ClearingHouse_InsufficientDiffBtwLiquidationDiscountAndNonUACollSeizureDiscount',
  InsufficientUaDebtSeizureThreshold = 'ClearingHouse_InsufficientUaDebtSeizureThreshold',
}

export enum ClearingHouseViewerErrors {
  ZeroAddressConstructor = 'ClearingHouseViewer_ZeroAddressConstructor',
}

export enum PerpetualErrors {
  ZeroAddressConstructor = 'Perpetual_ZeroAddressConstructor',
  VirtualTokenApprovalConstructor = 'Perpetual_VirtualTokenApprovalConstructor',
  MarketEqualFees = 'Perpetual_MarketEqualFees',
  InvalidAdminFee = 'Perpetual_InvalidAdminFee',
  SenderNotClearingHouse = 'Perpetual_SenderNotClearingHouse',
  ExcessiveBlockTradeAmount = 'Perpetual_ExcessiveBlockTradeAmount',
  NoOpenPosition = 'Perpetual_NoOpenPosition',
  LPWithdrawExceedsBalance = 'Perpetual_LPWithdrawExceedsBalance',
  LockPeriodNotReached = 'Perpetual_LockPeriodNotReached',
  InsuranceFeeInvalid = 'Perpetual_InsuranceFeeInvalid',
  LpDebtCoefInvalid = 'Perpetual_LpDebtCoefInvalid',
  TradingFeeInvalid = 'Perpetual_TradingFeeInvalid',
  SensitivityInvalid = 'Perpetual_SensitivityInvalid',
  TwapFrequencyInvalid = 'Perpetual_TwapFrequencyInvalid',
  MaxBlockAmountInvalid = 'Perpetual_MaxBlockAmountInvalid',
  LockPeriodInvalid = 'Perpetual_LockPeriodInvalid',
  RiskWeightInvalid = 'Perpetual_RiskWeightInvalid',
  MarketBalanceTooLow = 'Perpetual_MarketBalanceTooLow',
  LPOpenPosition = 'Perpetual_LPOpenPosition',
  AttemptReversePosition = 'Perpetual_AttemptReversePosition',
  ProposedAmountExceedsPositionSize = 'Perpetual_ProposedAmountExceedsPositionSize',
  ProposedAmountExceedsMaxMarketPrice = 'Perpetual_ProposedAmountExceedsMaxMarketPrice',
  MaxLiquidityProvided = 'Perpetual_MaxLiquidityProvided',
  MaxPositionSize = 'Perpetual_MaxPositionSize',
  LpAmountDeviation = 'Perpetual_LpAmountDeviation',
}

export enum InsuranceErrors {
  ZeroAddressConstructor = 'Insurance_ZeroAddressConstructor',
  ClearingHouseZeroAddress = 'Insurance_ClearingHouseZeroAddress',
  SenderNotVault = 'Insurance_SenderNotVault',
  InsufficientBalance = 'Insurance_InsufficientBalance',
  InsufficientInsurance = 'Insurance_InsufficientInsurance',
}

export enum OracleErrors {
  InvalidRoundTimestamp = 'Oracle_InvalidRoundTimestamp',
  InvalidRoundPrice = 'Oracle_InvalidRoundPrice',
  DataNotFresh = 'Oracle_DataNotFresh',
  AssetZeroAddress = 'Oracle_AssetZeroAddress',
  AggregatorZeroAddress = 'Oracle_AggregatorZeroAddress',
  UnsupportedAsset = 'Oracle_UnsupportedAsset',
  SequencerUptimeFeedZeroAddress = 'Oracle_SequencerUptimeFeedZeroAddress',
  IncorrectGracePeriod = 'Oracle_IncorrectGracePeriod',
  SequencerDown = 'Oracle_SequencerDown',
  GracePeriodNotOver = 'Oracle_GracePeriodNotOver',
}

export enum VaultErrors {
  ZeroAddressConstructor = 'Vault_ZeroAddressConstructor',
  SenderNotClearingHouse = 'Vault_SenderNotClearingHouse',
  SenderNotClearingHouseNorInsurance = 'Vault_SenderNotClearingHouseNorInsurance',
  InvalidToken = 'Vault_InvalidToken',
  DepositInsufficientAmount = 'Vault_DepositInsufficientAmount',
  DepositTotalExceedsMax = 'Vault_DepositTotalExceedsMax',
  WithdrawReductionRatioTooHigh = 'Vault_WithdrawReductionRatioTooHigh',
  WithdrawExcessiveAmount = 'Vault_WithdrawExcessiveAmount',
  ClearingHouseZeroAddress = 'Vault_ClearingHouseZeroAddress',
  InsuranceZeroAddress = 'Vault_InsuranceZeroAddress',
  OracleZeroAddress = 'Vault_OracleZeroAddress',
  MaxTVLZero = 'Vault_MaxTVLZero',
  InsufficientCollateralWeight = 'Vault_InsufficientCollateralWeight',
  ExcessiveCollateralWeight = 'Vault_ExcessiveCollateralWeight',
  CollateralAlreadyWhiteListed = 'Vault_CollateralAlreadyWhiteListed',
  UnsupportedCollateral = 'Vault_UnsupportedCollateral',
  UADebt = 'Vault_UADebt',
  InsufficientBalance = 'Vault_InsufficientBalance',
  MaxCollateralAmountExceeded = 'Vault_MaxCollateralAmountExceeded',
}

export enum TestPerpetualErrors {
  InvalidTokenIndex = 'TestPerpetual_InvalidTokenIndex',
  BuyAmountTooSmall = 'TestPerpetual_BuyAmountTooSmall',
}

export enum VBaseErrors {
  InsufficientPrecision = 'VBase_InsufficientPrecision',
  InvalidRoundTimestamp = 'VBase_InvalidRoundTimestamp',
  DataNotFresh = 'VBase_DataNotFresh',
  InvalidRoundPrice = 'VBase_InvalidRoundPrice',
  SequencerUptimeFeedZeroAddress = 'VBase_SequencerUptimeFeedZeroAddress',
  IncorrectGracePeriod = 'VBase_IncorrectGracePeriod',
  SequencerDown = 'VBase_SequencerDown',
  GracePeriodNotOver = 'VBase_GracePeriodNotOver',
}

export enum UAErrors {
  ReserveTokenZeroAddress = 'UA_ReserveTokenZeroAddress',
  InvalidReserveTokenIndex = 'UA_InvalidReserveTokenIndex',
  ReserveTokenAlreadyAssigned = 'UA_ReserveTokenAlreadyAssigned',
  ExcessiveTokenMintCapReached = 'UA_ExcessiveTokenMintCapReached',
}

// Build revert string from a function
// openzeppelin does not support custom errors
// https://github.com/OpenZeppelin/openzeppelin-contracts/issues/2839
// https://github.com/OpenZeppelin/openzeppelin-contracts/issues/3476
export const AccessControlErrors = {
  revertGovernance(address: tEthereumAddress): string {
    return buildRevertString(
      address.toLowerCase(),
      keccak256(toUtf8Bytes('GOVERNANCE'))
    );
  },
  revertManager(address: tEthereumAddress): string {
    return buildRevertString(
      address.toLowerCase(),
      keccak256(toUtf8Bytes('MANAGER'))
    );
  },
};

// returns the revert string by the access control contract
// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/ec825d8999538f110e572605dc56ef7bf44cc574/contracts/access/AccessControl.sol#L109-L116
const buildRevertString = (address: tEthereumAddress, role: string): string => {
  return `AccessControl: account ${address} is missing role ${role}`;
};
