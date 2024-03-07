import { Contract, Interface, id } from "ethers";
import { utils } from "zksync-ethers";
import * as hre from "hardhat";

import { getWallet, getL1Wallet } from "./utils";
import constants from "./constants";

export default async function() {
  const marketBaseCurrency = process.env.MARKET_BASE_CURRENCY;
  if (!marketBaseCurrency) {
    throw "⛔️ Market base currency wasn't found in .env file!";
  }

  // Initial deployment of VBase and VQuote
  const wallet = getWallet();
  const l1Wallet = getL1Wallet();

  // Proposal Creation on L1

  const governorArtifact = await hre.artifacts.readArtifact("IGovernor");
  const governor = new Contract(
    constants.addresses.L1_GOVERNOR,
    [
      ...governorArtifact.abi,
      {
        type: "function",
        name: "queue",
        inputs: [
          { name: "targets", type: "address[]", internalType: "address[]" },
          { name: "values", type: "uint256[]", internalType: "uint256[]" },
          { name: "calldatas", type: "bytes[]", internalType: "bytes[]" },
          { name: "descriptionHash", type: "bytes32", internalType: "bytes32" }
        ],
        outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
        stateMutability: "nonpayable"
      }
    ],
    l1Wallet
  );

  /**
   * LAYER 2
   */

  const multicallTargets = [];
  const multicallDatas = [];

  console.log(
    "Step 1: Encode grantRole(GOVERNANCE) to Perpetual Market Factory"
  );
  const ClearingHouseArtifact = await hre.artifacts.readArtifact(
    "ClearingHouse"
  );
  const clearingHouseInterface = new Interface(ClearingHouseArtifact.abi);
  const clearingHouse = new Contract(
    constants.addresses.CLEARING_HOUSE,
    ClearingHouseArtifact.abi,
    wallet
  );
  const governanceRole = await clearingHouse.GOVERNANCE();
  multicallTargets.push(constants.addresses.CLEARING_HOUSE);
  multicallDatas.push(
    clearingHouseInterface.encodeFunctionData("grantRole", [
      governanceRole,
      constants.addresses.PERP_MARKET_FACTORY
    ])
  );

  console.log("Step 2: Encode Perpetual Market Factory Deployment");
  const perpMarketFactoryArtifact = await hre.artifacts.readArtifact(
    "PerpMarketFactory"
  );
  const perpMarketInterface = new Interface(perpMarketFactoryArtifact.abi);
  const marketParams = constants.marketParams[marketBaseCurrency];
  multicallTargets.push(constants.addresses.PERP_MARKET_FACTORY);
  multicallDatas.push(
    perpMarketInterface.encodeFunctionData("deployNewMarket", [
      constants.addresses.ORACLES[marketBaseCurrency],
      constants.addresses.SEQUENCER_UPTIME_FEED,
      `v${marketBaseCurrency} base token`,
      `v${marketBaseCurrency}`,
      `${marketBaseCurrency}USD`,
      `${marketBaseCurrency}USD`,
      {
        riskWeight: marketParams.riskWeight,
        maxLiquidityProvided: marketParams.maxLiquidityProvided,
        twapFrequency: marketParams.twapFrequency,
        sensitivity: marketParams.sensitivity,
        maxBlockTradeAmount: marketParams.maxBlockTradeAmount,
        insuranceFee: marketParams.insuranceFee,
        lpDebtCoef: marketParams.lpDebtCoef,
        lockPeriod: marketParams.lockPeriod,
        heartBeat: marketParams.heartBeat,
        gracePeriod: marketParams.gracePeriod,
        a: marketParams.A,
        gamma: marketParams.gamma,
        midFee: marketParams.mid_fee,
        outFee: marketParams.out_fee,
        allowedExtraProfit: marketParams.allowed_extra_profit,
        feeGamma: marketParams.fee_gamma,
        adjustmentStep: marketParams.adjustment_step,
        adminFee: marketParams.admin_fee,
        maHalfTime: marketParams.ma_half_time
      }
    ])
  );

  console.log(
    "Step 3: Encode revokeRole(GOVERNANCE) to Perpetual Market Factory"
  );
  multicallTargets.push(constants.addresses.CLEARING_HOUSE);
  multicallDatas.push(
    clearingHouseInterface.encodeFunctionData("revokeRole", [
      governanceRole,
      constants.addresses.PERP_MARKET_FACTORY
    ])
  );

  /**
   * LAYER 1
   */

  console.log("Step 4: Encode Multicall");
  const multicallArtifact = await hre.artifacts.readArtifact("OwnedMulticall3");
  const multicallInterface = new Interface(multicallArtifact.abi);
  const multicallData = multicallInterface.encodeFunctionData("aggregate3", [
    multicallTargets.map((target, i) => ({
      target,
      callData: multicallDatas[i],
      allowFailure: false
    }))
  ]);

  console.log(
    "Step 5: Estimate gas cost for multicall transaction (overestimate by 3x)"
  );
  const zkSyncAddress = await wallet.provider.getMainContractAddress();
  const zkSyncContract = new Contract(
    zkSyncAddress,
    utils.ZKSYNC_MAIN_ABI,
    l1Wallet
  );
  const gasPrice = (await l1Wallet.provider.getFeeData()).gasPrice * 3n;
  const gasLimit = await wallet.provider.estimateL1ToL2Execute({
    contractAddress: constants.addresses.OWNED_MULTICALL,
    calldata: multicallData,
    caller: utils.applyL1ToL2Alias(constants.addresses.L1_TIMELOCK)
  });
  let baseCost = await zkSyncContract.l2TransactionBaseCost(
    gasPrice,
    gasLimit,
    utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT
  );

  console.log("Step 6: Encode Cross chain transaction");
  const l2TransactionData = zkSyncContract.interface.encodeFunctionData(
    "requestL2Transaction",
    [
      constants.addresses.OWNED_MULTICALL,
      0,
      multicallData,
      gasLimit,
      utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT,
      [],
      constants.addresses.OWNED_MULTICALL
    ]
  );

  console.log("Step 7: Create proposal");
  const proposalDescription = `add ${marketBaseCurrency}USD market`;

  let proposalId = await governor.propose.staticCall(
    [zkSyncAddress],
    [baseCost],
    [l2TransactionData],
    proposalDescription
  );
  const proposalTx = await governor.propose(
    [zkSyncAddress],
    [baseCost],
    [l2TransactionData],
    proposalDescription
  );
  await proposalTx.wait();
  console.log(`Proposal ${proposalId} created with params: `, {
    targets: [zkSyncAddress],
    values: [baseCost],
    calldatas: [l2TransactionData],
    description: proposalDescription
  });
}
