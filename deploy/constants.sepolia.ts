import { parseUnits, parseEther } from "ethers";

export default {
  addresses: {
    CRYPTO_SWAP_FACTORY: "0x5Cf551789B86674C69195c31D59A5542246c9143",
    USDC: "0xd88D19467f464e070Ebdb34a71D8b728CcE5E8c9",
    CURVE_MATH: "0xa6C87D8ffB484659ce920CF58f536BcaD6E56801",
    L1_GOVERNOR: "0xCCA9146Cd8a10364EfBe522D07794bBAA4Ed7101",
    L1_TIMELOCK: "0x9366B4B689Fb7BF53940A39eEf541f8209D685e4",
    EMERGENCY_ADMIN: "0xe7b74bd0524cF3Cc975Aa9533C9Ef6936Fc92532",
    CLEARING_HOUSE: "0x6C3388fc1dfa9733FeED87cD3639b463Ee072a8a",
    CURVE_CRYPTO_VIEWS: "0x979864867e22f5467259f03A16822759376D8e98",
    OWNED_MULTICALL: "0x9a42921132140c036579AEFdf72660Fc923bdaf0",
    SEQUENCER_UPTIME_FEED: "0x66ff42cA512e78b2e5aa4715FCb655905d633326",
    PERP_MARKET_FACTORY: "0xAbF635A60a54E25Ca0e3A6a177C58fa1473C7ABD",
    ZKSYNC_DIAMOND_PROXY: "0x9A6DE0f62Aa270A8bCB1e2610078650D539B1Ef9",
    ORACLES: {
      ETH: "0x827B959E10f6bd93A74aa8C49a47ef1583DC4E7B",
      USDC: "0x7cE598670861E8a68D31290469787C1FF3cBB21e"
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
    heartBeat: "86400",
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
