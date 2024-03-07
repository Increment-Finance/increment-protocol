import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { parseEther } from "ethers";
import { utils } from "zksync-ethers";
import * as hre from "hardhat";

import { deployContract, getWallet } from "./utils";
import constants from "./constants";

export default async function() {
  const wallet = getWallet();
  const deployer = new Deployer(hre, wallet);

  // Deploy UA Contract
  const ua = await deployContract("UA", [
    constants.addresses.USDC,
    constants.global.initialTokenMaxMintCap.toString()
  ]);
  const uaAddress = await ua.getAddress();

  // Deploy Vault Contract
  const vault = await deployContract("Vault", [uaAddress]);
  const vaultAddress = await vault.getAddress();

  // Deploy Insurance Contract
  const insurance = await deployContract("Insurance", [
    uaAddress,
    vaultAddress
  ]);
  const insuranceAddress = await insurance.getAddress();
  await vault.setInsurance(insuranceAddress).then(tx => tx.wait());

  // Deploy Sequencer Uptime Feed Contract
  const sequencerUptimeFeed = await deployContract("SequencerUptimeFeed");
  const sequencerUptimeFeedAddress = await sequencerUptimeFeed.getAddress();

  // Deploy Oracle
  const oracle = await deployContract("Oracle", [
    sequencerUptimeFeedAddress,
    constants.global.gracePeriod
  ]);
  await oracle
    .setOracle(
      uaAddress,
      constants.addresses.ORACLES.USDC,
      constants.global.uaHeartBeat,
      false
    )
    .then(tx => tx.wait());
  await oracle
    .setFixedPrice(uaAddress, parseEther("1").toString())
    .then(tx => tx.wait());
  const oracleAddress = await oracle.getAddress();
  await vault.setOracle(oracleAddress).then(tx => tx.wait());

  // Deploy ClearingHouse Contract
  const clearingHouse = await deployContract("ClearingHouse", [
    vaultAddress,
    insuranceAddress,
    {
      minMargin: constants.global.minMargin,
      minMarginAtCreation: constants.global.minMarginAtCreation,
      minPositiveOpenNotional: constants.global.minPositiveOpenNotional,
      liquidationReward: constants.global.liquidationReward,
      insuranceRatio: constants.global.insuranceRatio,
      liquidationRewardInsuranceShare:
        constants.global.liquidationRewardInsuranceShare,
      liquidationDiscount: constants.global.liquidationDiscount,
      nonUACollSeizureDiscount: constants.global.nonUACollSeizureDiscount,
      uaDebtSeizureThreshold: constants.global.uaDebtSeizureThreshold
    }
  ]);
  const clearingHouseAddress = await clearingHouse.getAddress();
  await vault.setClearingHouse(clearingHouseAddress).then(tx => tx.wait());
  await insurance.setClearingHouse(clearingHouseAddress).then(tx => tx.wait());

  // Deploy CryptoViews Contract
  const curveCryptoViews = await deployContract("CurveCryptoViews", [
    constants.addresses.CURVE_MATH
  ]);
  const curveCryptoViewsAddress = await curveCryptoViews.getAddress();

  // Deploy ClearingHouseViewer
  await deployContract("ClearingHouseViewer", [clearingHouseAddress]);

  // Deploy UAHelper
  await deployContract("UAHelper", [uaAddress, clearingHouseAddress]);

  // Deploy multicall
  const ownedMulticall = await deployContract("OwnedMulticall3");
  const ownedMulticallAddress = await ownedMulticall.getAddress();

  const timelockAlias = utils.applyL1ToL2Alias(constants.addresses.L1_TIMELOCK);
  await ownedMulticall.transferOwnership(timelockAlias);

  // Deploy PerpMarketFactory
  const marketFactoryArtifact = await deployer.loadArtifact(
    "PerpMarketFactory"
  );
  const vBaseArtifact = await deployer.loadArtifact("VBase");
  const vBaseBytecodeHash = utils.hashBytecode(vBaseArtifact.bytecode);
  const vQuoteArtifact = await deployer.loadArtifact("VQuote");
  const vQuoteBytecodeHash = utils.hashBytecode(vQuoteArtifact.bytecode);
  const perpArtifact = await deployer.loadArtifact("Perpetual");
  const perpBytecodeHash = utils.hashBytecode(perpArtifact.bytecode);

  const marketFactory = await deployer.deploy(
    marketFactoryArtifact,
    [
      perpBytecodeHash,
      vBaseBytecodeHash,
      vQuoteBytecodeHash,
      constants.addresses.CRYPTO_SWAP_FACTORY,
      curveCryptoViewsAddress,
      clearingHouseAddress,
      ownedMulticallAddress,
      constants.addresses.EMERGENCY_ADMIN
    ],
    undefined,
    [vBaseArtifact.bytecode, vQuoteArtifact.bytecode, perpArtifact.bytecode]
  );
  console.log("Market Factory deployed at: ", await marketFactory.getAddress());

  // Transfer Ownership

  // UA
  let governanceRole = await ua.GOVERNANCE();
  let emergencyAdminRole = await ua.EMERGENCY_ADMIN();

  await ua.grantRole(governanceRole, ownedMulticallAddress);
  await ua.grantRole(emergencyAdminRole, constants.addresses.EMERGENCY_ADMIN);
  await ua.renounceRole(governanceRole, wallet.address);
  await ua.renounceRole(emergencyAdminRole, wallet.address);

  // Vault
  governanceRole = await vault.GOVERNANCE();
  emergencyAdminRole = await vault.EMERGENCY_ADMIN();

  await vault.grantRole(governanceRole, ownedMulticallAddress);
  await vault.grantRole(
    emergencyAdminRole,
    constants.addresses.EMERGENCY_ADMIN
  );
  await vault.renounceRole(governanceRole, wallet.address);
  await vault.renounceRole(emergencyAdminRole, wallet.address);

  // Insurance
  governanceRole = await insurance.GOVERNANCE();
  emergencyAdminRole = await insurance.EMERGENCY_ADMIN();

  await insurance.grantRole(governanceRole, ownedMulticallAddress);
  await insurance.grantRole(
    emergencyAdminRole,
    constants.addresses.EMERGENCY_ADMIN
  );
  await insurance.renounceRole(governanceRole, wallet.address);
  await insurance.renounceRole(emergencyAdminRole, wallet.address);

  // Oracle
  governanceRole = await oracle.GOVERNANCE();
  emergencyAdminRole = await oracle.EMERGENCY_ADMIN();

  await oracle.grantRole(governanceRole, ownedMulticallAddress);
  await oracle.grantRole(
    emergencyAdminRole,
    constants.addresses.EMERGENCY_ADMIN
  );
  await oracle.renounceRole(governanceRole, wallet.address);
  await oracle.renounceRole(emergencyAdminRole, wallet.address);

  // ClearingHouse
  governanceRole = await clearingHouse.GOVERNANCE();
  emergencyAdminRole = await clearingHouse.EMERGENCY_ADMIN();

  await clearingHouse.grantRole(governanceRole, ownedMulticallAddress);
  await clearingHouse.grantRole(
    emergencyAdminRole,
    constants.addresses.EMERGENCY_ADMIN
  );
  await clearingHouse.renounceRole(governanceRole, wallet.address);
  await clearingHouse.renounceRole(emergencyAdminRole, wallet.address);
}
