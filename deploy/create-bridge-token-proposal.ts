import {
  Contract,
  Interface,
  AddressLike,
  BigNumberish,
  parseEther,
  formatEther,
} from "ethers";
import { utils } from "zksync-ethers";
import * as hre from "hardhat";

import { getWallet, getL1Wallet, getEnvVariable } from "./utils";
import constants from "./constants";

export default async function () {
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
          { name: "descriptionHash", type: "bytes32", internalType: "bytes32" },
        ],
        outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
        stateMutability: "nonpayable",
      },
    ],
    l1Wallet
  );

  const zkSyncAddress = await wallet.provider.getMainContractAddress();
  const zkSyncContract = new Contract(
    zkSyncAddress,
    utils.ZKSYNC_MAIN_ABI,
    l1Wallet
  );
  const gasPrice = (await l1Wallet.provider.getFeeData()).gasPrice * 3n;

  const targets: AddressLike[] = [];
  const values: BigNumberish[] = [];
  const calldatas: string[] = [];

  const merkleRoot = getEnvVariable("MERKLE_ROOT");
  const ipfsHash = getEnvVariable("IPFS_HASH");
  const tokenAmount = parseEther("400000");

  /**
   * LAYER 1
   */

  console.log("Step 0: Encode unpause() to IncrementToken");
  const IncrementTokenArtifact = await hre.artifacts.readArtifact("ERC20");
  const incrementTokenInterface = new Interface([
    ...IncrementTokenArtifact.abi,
    {
      type: "function",
      name: "unpause",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable",
    },
  ]);
  targets.push(constants.addresses.L1_TOKEN);
  values.push(0);
  calldatas.push(incrementTokenInterface.encodeFunctionData("unpause", []));

  console.log(
    "Step 1: Encode approve(L1ERC20Bridge, amount) to IncrementToken"
  );
  targets.push(constants.addresses.L1_TOKEN);
  values.push(0);
  calldatas.push(
    incrementTokenInterface.encodeFunctionData("approve", [
      constants.addresses.L1_BRIDGE,
      tokenAmount,
    ])
  );

  console.log("Step 2: Encode deposit to L1Bridge");
  const l1BridgeInterface = utils.L1_BRIDGE_ABI;
  const l1Bridge = new Contract(
    constants.addresses.L1_BRIDGE,
    l1BridgeInterface,
    l1Wallet
  );
  const l2GasEstimate = await utils
    .estimateDefaultBridgeDepositL2Gas(
      l1Wallet.provider,
      wallet.provider,
      constants.addresses.L1_TOKEN,
      tokenAmount,
      constants.addresses.OWNED_MULTICALL,
      constants.addresses.L1_TIMELOCK
    )
    .then((gasEstimate) => gasEstimate * 3n); // Overestimate by 3x
  const baseCostBridge = await zkSyncContract.l2TransactionBaseCost(
    gasPrice,
    l2GasEstimate,
    utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT
  );
  targets.push(constants.addresses.L1_BRIDGE);
  values.push(baseCostBridge);
  calldatas.push(
    l1BridgeInterface.encodeFunctionData("deposit", [
      constants.addresses.OWNED_MULTICALL,
      constants.addresses.L1_TOKEN,
      tokenAmount,
      l2GasEstimate,
      utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT,
      constants.addresses.EMERGENCY_ADMIN,
    ])
  );

  /**
   * LAYER 2
   */

  const multicallTargets = [];
  const multicallDatas = [];

  console.log("Step 3: Encode Multicall");

  console.log(
    "  Step 3a: approve(MerkleDistributor, amount) to bridged IncrementToken"
  );
  const bridgedTokenAddress = l1Bridge.l2TokenAddress(
    constants.addresses.L1_TOKEN
  );
  multicallTargets.push(bridgedTokenAddress);
  multicallDatas.push(
    incrementTokenInterface.encodeFunctionData("approve", [
      constants.addresses.MERKLE_DISTRIBUTOR,
      tokenAmount,
    ])
  );

  console.log(
    "  Step 3b: Encode setWindow(amount, bridgedToken, merkleRoot, ipfsHash) to MerkleDistributor"
  );

  const merkleDistributorInterface = new Interface([
    {
      type: "function",
      name: "setWindow",
      inputs: [
        { name: "rewardsToDeposit", type: "uint256", internalType: "uint256" },
        { name: "rewardToken", type: "address", internalType: "address" },
        { name: "merkleRook", type: "bytes32", internalType: "bytes32" },
        { name: "ipfsHash", type: "string", internalType: "string" },
      ],
      outputs: [],
      stateMutability: "nonpayable",
    },
  ]);
  multicallTargets.push(constants.addresses.MERKLE_DISTRIBUTOR);
  multicallDatas.push(
    merkleDistributorInterface.encodeFunctionData("setWindow", [
      tokenAmount,
      bridgedTokenAddress,
      merkleRoot,
      ipfsHash,
    ])
  );

  /**
   * LAYER 1
   */

  console.log("  Step 3c: Encode aggregate3(Call[] calls) to OwnedMulticall");
  const multicallArtifact = await hre.artifacts.readArtifact("OwnedMulticall3");
  const multicallInterface = new Interface(multicallArtifact.abi);
  const multicallData = multicallInterface.encodeFunctionData("aggregate3", [
    multicallTargets.map((target, i) => ({
      target,
      callData: multicallDatas[i],
      allowFailure: false,
    })),
  ]);

  console.log(
    "  Step 3d: Estimate gas cost for multicall transaction (overestimate by 3x)"
  );
  const gasLimit = await wallet.provider.estimateL1ToL2Execute({
    contractAddress: constants.addresses.OWNED_MULTICALL,
    calldata: multicallData,
    caller: utils.applyL1ToL2Alias(constants.addresses.L1_TIMELOCK),
  });
  let baseCost = await zkSyncContract.l2TransactionBaseCost(
    gasPrice,
    gasLimit,
    utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT
  );

  console.log("  Step 3e: Encode Cross chain transaction");
  const l2TransactionData = zkSyncContract.interface.encodeFunctionData(
    "requestL2Transaction",
    [
      constants.addresses.OWNED_MULTICALL,
      0,
      multicallData,
      gasLimit,
      utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT,
      [],
      constants.addresses.EMERGENCY_ADMIN,
    ]
  );
  targets.push(zkSyncAddress);
  values.push(baseCost);
  calldatas.push(l2TransactionData);

  console.log("Step 4: Create proposal");
  const proposalDescription = `Transfer ${formatEther(
    tokenAmount
  )} INCR to MerkleDistributor on Era`;

  let proposalId = await governor.propose.staticCall(
    targets,
    values,
    calldatas,
    proposalDescription
  );
  const proposalTx = await governor.propose(
    targets,
    values,
    calldatas,
    proposalDescription
  );
  await proposalTx.wait();
  console.log(`Proposal ${proposalId} created with params: `, {
    targets: targets,
    values: values,
    calldatas: calldatas,
    description: proposalDescription,
  });
}
