import { parseUnits, parseEther } from "ethers";

export default {
  addresses: {
    CRYPTO_SWAP_FACTORY: "0x890b12affd59525e4f0273aF00Dcd9c4Ac7698C1",
    USDC: "0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4",
    CURVE_MATH: "0xAb880013531B87FFfCB5e9d95677913720ca1c3A",
    L1_GOVERNOR: "0x134E7ABaF7E8c440f634aE9f5532A4df53c19385",
    L1_TIMELOCK: "0xcce2065c1DC423451530BF7B493243234Ba1E849",
    EMERGENCY_ADMIN: "0x4f05E10B7e60D5b18c38a723d9469b4962C288D9",
    CLEARING_HOUSE: "0x9200536A28b0Bf5d02b7d8966cd441EDc173dE61",
    CURVE_CRYPTO_VIEWS: "0x7b80A367Fd0179CF920391dFfaD376a72724d516",
    OWNED_MULTICALL: "0x3082263EC78fa714a48F62869a77dABa0FfeF583",
    SEQUENCER_UPTIME_FEED: "0x1589148e57C0034A8Bf230E601fde6e23171854d",
    PERP_MARKET_FACTORY: "0xCbba059D8E8AcC2C69bA94400686106b2396d786",
    ZKSYNC_DIAMOND_PROXY: "0x32400084c286cf3e17e7b677ea9583e60a000324",
    ORACLES: {
      ETH: "0x6D41d1dc818112880b40e26BD6FD347E41008eDA",
      USDC: "0x1824D297C6d6D311A204495277B63e943C2D376E"
    }
  },
  global: {
    minMargin: parseEther("0.03"),
    minMarginAtCreation: parseEther("0.05"),
    minPositiveOpenNotional: parseEther("35"),
    liquidationReward: parseEther("0.015"),
    insuranceRatio: parseEther("0.1"),
    liquidationRewardInsuranceShare: parseEther("0.3"),
    liquidationDiscount: parseEther("0.95"),
    nonUACollSeizureDiscount: parseEther("0.85"),
    uaDebtSeizureThreshold: parseEther("10000"),
    gracePeriod: "300",
    uaHeartBeat: "86400",
    initialTokenMaxMintCap: parseEther("10000000")
  },
  marketParams: {
    ETH: {
      riskWeight: parseEther("3"),
      maxLiquidityProvided: parseEther("2000000"),
      twapFrequency: "900",
      sensitivity: parseUnits("3", 18),
      maxBlockTradeAmount: parseEther("50000"),
      insuranceFee: parseEther("0.001"),
      lpDebtCoef: parseEther("3"),
      lockPeriod: "3600",
      heartBeat: "86400",
      gracePeriod: "300",

      A: "400000",
      gamma: "145000000000000",
      mid_fee: "26000000",
      out_fee: "45000000",
      allowed_extra_profit: "2000000000000",
      fee_gamma: "230000000000000",
      adjustment_step: "146000000000000",
      admin_fee: "0",
      ma_half_time: "600"
    }
  }
};
