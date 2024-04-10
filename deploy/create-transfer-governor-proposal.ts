import {
  Contract,
  Interface,
  AddressLike,
  BigNumberish,
  parseEther,
} from "ethers";
import { utils } from "zksync-ethers";
import * as hre from "hardhat";

import { getWallet, getL1Wallet } from "./utils";
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

  const AccessControlArtifact = await hre.artifacts.readArtifact(
    "IncreAccessControl"
  );
  const accessControlInterface = new Interface(AccessControlArtifact.abi);
  const clearingHouseAccessControl = new Contract(
    constants.addresses.CLEARING_HOUSE,
    AccessControlArtifact.abi,
    wallet
  );
  const governanceRole = await clearingHouseAccessControl.GOVERNANCE();

  const targets: AddressLike[] = [];
  const values: BigNumberish[] = [];
  const calldatas: string[] = [];

  const tokenAmount = parseEther("11200000");
  const nativeAmount = await l1Wallet.provider.getBalance(
    constants.addresses.L1_TIMELOCK
  );
  const governedAddresses = [
    {
      name: "ClearingHouse",
      address: constants.addresses.CLEARING_HOUSE,
    },
    {
      name: "UA",
      address: constants.addresses.UA,
    },
    {
      name: "Vault",
      address: constants.addresses.VAULT,
    },
    {
      name: "Insurance",
      address: constants.addresses.INSURANCE,
    },
    {
      name: "Oracle",
      address: constants.addresses.ORACLE,
    },
    {
      name: "ETHUSD Perpetual",
      address: constants.addresses.PERPETUALS.ETHUSD.PERPETUAL,
    },
    {
      name: "ETHUSD VBase",
      address: constants.addresses.PERPETUALS.ETHUSD.VBASE,
    },
    {
      name: "ETHUSD VQuote",
      address: constants.addresses.PERPETUALS.ETHUSD.VQUOTE,
    },
  ];

  /**
   * LAYER 1
   */

  console.log(
    "Step 1: Encode approve(L1ERC20Bridge, amount) to IncrementToken"
  );
  const IncrementTokenArtifact = await hre.artifacts.readArtifact("ERC20");
  const incrementTokenInterface = new Interface(IncrementTokenArtifact.abi);
  targets.push(constants.addresses.L1_TOKEN);
  values.push(0);
  calldatas.push(
    incrementTokenInterface.encodeFunctionData("approve", [
      constants.addresses.L1_BRIDGE,
      tokenAmount,
    ])
  );

  console.log("Step 2: Encode ERC20 deposit to L1Bridge");
  const l1BridgeInterface = utils.L1_BRIDGE_ABI;
  let l2GasEstimate = await utils
    .estimateDefaultBridgeDepositL2Gas(
      l1Wallet.provider,
      wallet.provider,
      constants.addresses.L1_TOKEN,
      tokenAmount,
      constants.addresses.L2_GOVERNOR,
      constants.addresses.L1_TIMELOCK
    )
    .then((gasEstimate) => gasEstimate * 3n); // Overestimate by 3x
  targets.push(constants.addresses.L1_BRIDGE);
  values.push(0);
  calldatas.push(
    l1BridgeInterface.encodeFunctionData("deposit", [
      constants.addresses.L2_GOVERNOR,
      constants.addresses.L1_TOKEN,
      tokenAmount,
      l2GasEstimate,
      utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT,
      constants.addresses.L2_GOVERNOR,
    ])
  );

  console.log("Step 3: Encode native ETH transfer to L2");
  const zkSyncAddress = await wallet.provider.getMainContractAddress();
  const zkSyncContract = new Contract(
    zkSyncAddress,
    utils.ZKSYNC_MAIN_ABI,
    l1Wallet
  );
  const gasPrice = (await l1Wallet.provider.getFeeData()).gasPrice * 3n;
  const gasLimitTransfer = await wallet.provider.estimateL1ToL2Execute({
    contractAddress: constants.addresses.L2_GOVERNOR,
    calldata: "",
    caller: utils.applyL1ToL2Alias(constants.addresses.L1_TIMELOCK),
    l2Value: nativeAmount,
  });
  const l2TransferData = zkSyncContract.interface.encodeFunctionData(
    "requestL2Transaction",
    [
      constants.addresses.L2_GOVERNOR,
      nativeAmount,
      "",
      gasLimitTransfer,
      utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT,
      [],
      constants.addresses.L2_GOVERNOR,
    ]
  );
  targets.push(zkSyncAddress);
  values.push(nativeAmount);
  calldatas.push(l2TransferData);

  /**
   * LAYER 2
   */

  const multicallTargets = [];
  const multicallDatas = [];

  console.log(
    "Step 4: Encode Multicall to grant and renounce GOVERNANCE roles"
  );
  console.log(`  GOVERNANCE = keccak256("GOVERNANCE") = ${governanceRole}`);

  console.log("  Step 4a: Grant governance roles to new governor");
  governedAddresses.forEach(({ name, address }, i) => {
    console.log(
      `      [${i}]: encoding ${name}.grantRole(GOVERNANCE, ${constants.addresses.L2_GOVERNOR})`
    );
    multicallTargets.push(address);
    multicallDatas.push(
      accessControlInterface.encodeFunctionData("grantRole", [
        governanceRole,
        constants.addresses.L2_GOVERNOR,
      ])
    );
  });

  console.log("  Step 4b: Renounce governance roles from OwnedMulticall");
  governedAddresses.forEach(({ name, address }, i) => {
    console.log(
      `      [${i}]: encoding ${name}.renounceRole(GOVERNANCE, ${constants.addresses.OWNED_MULTICALL})`
    );
    multicallTargets.push(address);
    multicallDatas.push(
      accessControlInterface.encodeFunctionData("renounceRole", [
        governanceRole,
        constants.addresses.OWNED_MULTICALL,
      ])
    );
  });

  console.log("  Step 4c: Encode aggregate3(Call[] calls) to OwnedMulticall");
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
    "  Step 4d: Estimate gas cost for multicall transaction (overestimate by 3x)"
  );
  const gasLimitMulticall = await wallet.provider.estimateL1ToL2Execute({
    contractAddress: constants.addresses.OWNED_MULTICALL,
    calldata: multicallData,
    caller: utils.applyL1ToL2Alias(constants.addresses.L1_TIMELOCK),
  });
  const baseCostMulticall = await zkSyncContract.l2TransactionBaseCost(
    gasPrice,
    gasLimitMulticall,
    utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT
  );

  /**
   * LAYER 1
   */

  console.log(
    "  Step 4e: Encode Cross chain multicall transaction to OwnedMulticall"
  );
  const l2MulticallData = zkSyncContract.interface.encodeFunctionData(
    "requestL2Transaction",
    [
      constants.addresses.OWNED_MULTICALL,
      0,
      multicallData,
      gasLimitMulticall,
      utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT,
      [],
      constants.addresses.L2_GOVERNOR,
    ]
  );
  targets.push(zkSyncAddress);
  values.push(baseCostMulticall);
  calldatas.push(l2MulticallData);

  /**
   * LAYER 2
   */

  console.log("Step 5: Renounce ownership of OwnedMulticall");

  console.log("  Step 5a: Encode renounceOwnership to OwnedMulticall");

  const renounceData = multicallInterface.encodeFunctionData(
    "renounceOwnership",
    []
  );

  console.log(
    "  Step 5b: Estimate gas cost for renounce transaction (overestimate by 3x)"
  );

  const gasLimitRenounce = await wallet.provider.estimateL1ToL2Execute({
    contractAddress: constants.addresses.OWNED_MULTICALL,
    calldata: renounceData,
    caller: utils.applyL1ToL2Alias(constants.addresses.L1_TIMELOCK),
  });
  const baseCostRenounce = await zkSyncContract.l2TransactionBaseCost(
    gasPrice,
    gasLimitRenounce,
    utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT
  );

  /**
   * LAYER 1
   */

  console.log(
    "  Step 5c: Encode Cross chain renounce transaction to OwnedMulticall"
  );
  const l2RenounceData = zkSyncContract.interface.encodeFunctionData(
    "requestL2Transaction",
    [
      constants.addresses.OWNED_MULTICALL,
      0,
      renounceData,
      gasLimitRenounce,
      utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT,
      [],
      constants.addresses.L2_GOVERNOR,
    ]
  );
  targets.push(zkSyncAddress);
  values.push(baseCostRenounce);
  calldatas.push(l2RenounceData);

  console.log("Step 6: Create proposal");
  const proposalDescription = "Transfer roles, assets to new governor on Era";

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
