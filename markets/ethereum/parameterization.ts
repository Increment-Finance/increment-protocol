import {BigNumber} from 'ethers';

import {
  GlobalConfig,
  MarketConfig,
  Parameterization,
} from '../../helpers/types';
import {parseEther, parseUnits} from 'ethers/lib/utils';
import {minutes, hours} from '../../helpers/time';
import {MAX_UINT_AMOUNT} from '../../helpers/constants';

const CRYPTO_RISK_WEIGHT = parseEther('3');
const FOREX_RISK_WEIGHT = parseEther('1');

export const parameterization: Parameterization = {
  global: {
    clearingHouseConfig: {
      minMargin: parseEther('0.03'),
      minMarginAtCreation: parseEther('0.05'),
      minPositiveOpenNotional: parseEther('35'), // $0.5 minimum reward / liquidationReward
      liquidationReward: parseEther('0.015'),
      insuranceRatio: parseEther('0.1'),
      liquidationRewardInsuranceShare: parseEther('0.3'),
      liquidationDiscount: parseEther('0.95'),
      nonUACollSeizureDiscount: parseEther('0.75'), // nonUACollSeizureDiscount + 2e17 <= liquidationDiscount
      uaDebtSeizureThreshold: parseEther('10000'), // 10k
    },
    oracleConfig: {
      gracePeriod: minutes(5),
    },
    vaultReserveTokenConfig: {
      ua: {
        weight: parseEther('1'),
        maxAmount: MAX_UINT_AMOUNT, // set minting caps in UA token config
      },
    },
    uaTokenConfig: {
      usdc: {
        maxMintCap: MAX_UINT_AMOUNT,
      },
    },
  } as GlobalConfig,
  markets: {
    EUR_USD: {
      perpetualConfig: {
        riskWeight: FOREX_RISK_WEIGHT,
        maxLiquidityProvided: parseEther('1000000'), // 1 mio USD
        twapFrequency: BigNumber.from(minutes(15)),
        sensitivity: parseEther('1'), // 1e18
        maxBlockTradeAmount: parseEther('100000'),
        insuranceFee: parseEther('0.001'), // appropriate for low volatility markets like EUR/USD
        lpDebtCoef: parseEther('3'),
        lockPeriod: hours(1),
      },
      baseConfig: {
        heartBeat: hours(25),
        gracePeriod: minutes(5),
      },
      cryptoSwapConfig: {
        A: BigNumber.from(5000)
          .mul(2 ** 2)
          .mul(10000),
        gamma: parseEther('0.0001'),
        mid_fee: parseUnits('0.0005', 10),
        out_fee: parseUnits('0.005', 10),
        allowed_extra_profit: parseUnits('10', 10),
        fee_gamma: parseEther('0.005'),
        adjustment_step: parseEther('0.0000055'),
        admin_fee: parseEther('0'), // set admin fee to zero
        ma_half_time: BigNumber.from(600),
      },
    } as MarketConfig,
    JPY_USD: {
      perpetualConfig: {
        riskWeight: FOREX_RISK_WEIGHT,
        maxLiquidityProvided: parseEther('1000000'), // 1 mio USD
        twapFrequency: BigNumber.from(minutes(15)),
        sensitivity: parseEther('1'), // 1e18
        maxBlockTradeAmount: parseEther('100000'),
        insuranceFee: parseEther('0.001'), // appropriate for low volatility markets like JPY/USD
        lpDebtCoef: parseEther('3'),
        lockPeriod: hours(1),
      },
      baseConfig: {
        heartBeat: hours(25),
        gracePeriod: minutes(5),
      },
      cryptoSwapConfig: {
        A: BigNumber.from(5000)
          .mul(2 ** 2)
          .mul(10000),
        gamma: parseEther('0.0001'),
        mid_fee: parseUnits('0.0005', 10),
        out_fee: parseUnits('0.005', 10),
        allowed_extra_profit: parseUnits('10', 10),
        fee_gamma: parseEther('0.005'),
        adjustment_step: parseEther('0.0000055'),
        admin_fee: parseEther('0'),
        ma_half_time: BigNumber.from(600),
      },
    } as MarketConfig,
    ETH_USD: {
      perpetualConfig: {
        riskWeight: CRYPTO_RISK_WEIGHT,
        maxLiquidityProvided: parseEther('1000000'), // 1 mio USD
        twapFrequency: BigNumber.from(minutes(15)),
        sensitivity: parseEther('1'), // 1e18
        maxBlockTradeAmount: parseEther('100000'),
        insuranceFee: parseEther('0.001'), // appropriate for low volatility markets like EUR/USD
        lpDebtCoef: parseEther('3'),
        lockPeriod: hours(1),
      },
      baseConfig: {
        heartBeat: hours(2),
        gracePeriod: minutes(5),
      },
      cryptoSwapConfig: {
        A: BigNumber.from(2)
          .mul(2 ** 2)
          .mul(10000),
        gamma: parseEther('0.000021'),
        mid_fee: parseUnits('0.0005', 10),
        out_fee: parseUnits('0.005', 10),
        allowed_extra_profit: parseUnits('10', 12).mul(2),
        fee_gamma: parseEther('0.0005'),
        adjustment_step: parseEther('0.00049'),
        admin_fee: parseEther('0'),
        ma_half_time: BigNumber.from(600),
      },
    } as MarketConfig,
  },
};
