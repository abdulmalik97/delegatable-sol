import { ethers } from "hardhat";
import { Contract, ContractFactory, utils, Wallet } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
// @ts-ignore
import { generateUtil } from "eth-delegatable-utils";
import { getPrivateKeys } from "../utils/getPrivateKeys";
// import sigUtil from "eth-sig-util";
import { Buffer } from "buffer";
import { expect } from "chai";
import { Provider } from "@ethersproject/providers";
import { generateDelegation } from "./utils";
// @ts-ignore
import createTypedMessage from "../scripts/createTypedMessage.js";
// @ts-ignore
// import friendlyTypes from "../scripts/types.js";
import types from "../scripts/friendlyTypes.js";
// @ts-ignore
import directTypes from "../scripts/types.js";
import { signTypedData_v4 } from "eth-sig-util";
import { TypedDataUtils, SignTypedDataVersion } from "@metamask/eth-sig-util";

const { getSigners } = ethers;
const CONTRACT_NAME = "DelegatableVoter";

const ownerHexPrivateKey =
  "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account1PrivKey =
  "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const account2PrivKey =
  "5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

describe("DelegatableVoter", () => {
  const CONTRACT_NAME = "DelegatableVoter";
  let CONTRACT_INFO: any;
  let delegatableUtils: any;
  let signer0: SignerWithAddress;
  let wallet0: Wallet;
  let wallet1: Wallet;
  let pk0: string;
  let pk1: string;

  let AllowedMethodsEnforcer: Contract;
  let AllowedMethodsEnforcerFactory: ContractFactory;
  let Delegatable: Contract;
  let DelegatableFactory: ContractFactory;
  let myContract: Contract;
  let proposalId = 1;

  before(async () => {
    [signer0] = await getSigners();
    [wallet0, wallet1] = getPrivateKeys(
      signer0.provider as unknown as Provider
    );
    myContract = await deployContract();
    console.log(myContract.signer);
    // DelegatableFactory = await ethers.getContractFactory("DelegatableVoter");
    AllowedMethodsEnforcerFactory = await ethers.getContractFactory(
      "AllowedMethodsEnforcer"
    );
    pk0 = wallet0._signingKey().privateKey;
    pk1 = wallet1._signingKey().privateKey;
  });

  beforeEach(async () => {
    // Delegatable = await DelegatableFactory.connect(wallet0).deploy(
    //   CONTRACT_NAME
    // );
    AllowedMethodsEnforcer = await AllowedMethodsEnforcerFactory.connect(
      wallet0
    ).deploy();

    CONTRACT_INFO = {
      chainId: myContract.deployTransaction.chainId,
      verifyingContract: myContract.address,
      name: CONTRACT_NAME,
    };
    delegatableUtils = generateUtil(CONTRACT_INFO);
  });

  it("Owner can make a proposal (no delegation)", async () => {
    const targetDescription = "Election Voting";
    const targetExpiryBlockNumber = 20;
    const createProposalTx = await myContract.createProposal(
      targetDescription,
      targetExpiryBlockNumber
    );
    const receipt = await createProposalTx.wait();
    proposalId = receipt.events[0].args[0];

    const proposal = await myContract.getProposal(proposalId);

    expect(proposal.description).to.equal(targetDescription);
    expect(proposal.expirationBlock.toNumber()).to.equal(
      targetExpiryBlockNumber
    );
  });

  it("User A can vote on an active proposal (no delegation)", async () => {
    const [_owner, addr1] = await ethers.getSigners();
    const proposalBefore = await myContract.getProposal(proposalId);
    await myContract.connect(addr1).vote(proposalId, true);

    const proposal = await myContract.getProposal(proposalId);
    expect(proposal.forVoteCounter.toNumber()).to.equal(
      proposalBefore.forVoteCounter.toNumber() + 1
    );
  });

  it("Owner can issue a delegation to User A to make a proposal ", async () => {
    try {
      const [owner, addr1, addr2] = await ethers.getSigners();
      [signer0] = await ethers.getSigners();
      [wallet0, wallet1] = getPrivateKeys(
        signer0.provider as unknown as Provider
      );
      const DelegatableFactory = await ethers.getContractFactory(
        "DelegatableVoter"
      );
      const myContract = await DelegatableFactory.connect(wallet0).deploy(
        CONTRACT_NAME,
        2
      );
      const PK1 = wallet1._signingKey().privateKey;
      const PK = wallet0._signingKey().privateKey.substring(2);
      const targetDescription = "Delegated Proposal";
      const targetExpiryBlockNumber = 90;
      const _delegation = generateDelegation(
        CONTRACT_NAME,
        myContract,
        PK,
        wallet1.address
      );

      const INVOCATION_MESSAGE = {
        replayProtection: {
          nonce: "0x01",
          queue: "0x00",
        },
        batch: [
          {
            authority: [_delegation],
            transaction: {
              to: myContract.address,
              gasLimit: "210000000000000000",
              data: (
                await myContract.populateTransaction.createProposal(
                  targetDescription,
                  targetExpiryBlockNumber
                )
              ).data,
            },
          },
        ],
      };

      const invocation = delegatableUtils.signInvocation(
        INVOCATION_MESSAGE,
        PK1
      );
      await myContract.invoke([
        {
          signature: invocation.signature,
          invocations: invocation.invocations,
        },
      ]);
    } catch (error) {
      console.log(error);
    }
  });

  it("User A can issue a delegation to User B to vote on User A’s behalf", async () => {
    const [owner, addr1, addr2] = await ethers.getSigners();

    const proposalBefore = await myContract.getProposal(proposalId);
    const { chainId } = await myContract.provider.getNetwork();
    const contractInfo = {
      chainId,
      verifyingContract: myContract.address,
      name: CONTRACT_NAME,
    };

    // Prepare the delegation message:
    // This message has no caveats, and authority 0,
    // so it is a simple delegation to addr1 with no restrictions,
    // and will allow the delegate to perform any action the signer could perform on this contract.
    const delegation = {
      delegate: addr1.address,
      authority:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      caveats: [],
    };

    const util = generateUtil(contractInfo);
    // Owner signs the delegation:
    const signedDelegation = util.signDelegation(
      delegation,
      ownerHexPrivateKey
    );

    // Delegate signs the invocation message:
    const desiredTx = await myContract.populateTransaction.vote(
      proposalId,
      true
    );
    const delegatePrivateKey = fromHexString(account1PrivKey);
    const invocationMessage = {
      replayProtection: {
        nonce: "0x01",
        queue: "0x00",
      },
      batch: [
        {
          authority: [signedDelegation],
          transaction: {
            to: myContract.address,
            gasLimit: "10000000000000000",
            data: desiredTx.data,
          },
        },
      ],
    };
    const typedInvocationMessage = createTypedMessage(
      myContract,
      invocationMessage,
      "Invocations",
      CONTRACT_NAME
    );
    let buffer = Buffer.from(delegatePrivateKey);

    const invocationSig = signTypedData_v4(buffer, typedInvocationMessage);
    const signedInvocation = {
      signature: invocationSig,
      invocations: invocationMessage,
    };

    // A third party can submit the invocation method to the chain:
    const res = await myContract.connect(addr2).invoke([signedInvocation]);

    const proposal = await myContract.getProposal(proposalId);
    // Verify the change was made:
    expect(parseInt(proposal.forVoteCounter.toNumber())).to.equal(
      parseInt(proposalBefore.forVoteCounter.toNumber()) + 1
    );
  });

  it("User A can issue a delegation to User B who re-delegates it to User C to vote on User A’s behalf", async () => {
    const [owner, addr1, addr2, addr3] = await ethers.getSigners();
    // const myContract = await deployContract();
    const { chainId } = await myContract.provider.getNetwork();
    const contractInfo = {
      chainId,
      verifyingContract: myContract.address,
      name: CONTRACT_NAME,
    };
    const util = generateUtil(contractInfo);
    const proposalBefore = await myContract.getProposal(proposalId);

    // Prepare the delegation message:
    // This message has no caveats, and authority 0,
    // so it is a simple delegation to addr1 with no restrictions,
    // and will allow the delegate to perform any action the signer could perform on this contract.
    const delegation = {
      delegate: addr1.address,
      authority:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      caveats: [],
    };

    // Owner signs the delegation:
    const signedDelegation = util.signDelegation(
      delegation,
      ownerHexPrivateKey
    );
    const delegationHash = TypedDataUtils.hashStruct(
      "SignedDelegation",
      signedDelegation,
      types,
      SignTypedDataVersion.V4
    );

    // First delegate signs the second delegation:
    const delegation2 = {
      delegate: addr2.address,
      authority: delegationHash,
      caveats: [],
    };
    const signedDelegation2 = util.signDelegation(delegation2, account1PrivKey);

    // Second delegate signs the invocation message:
    const desiredTx = await myContract.populateTransaction.vote(
      proposalId,
      true
    );
    const delegatePrivateKey = fromHexString(account2PrivKey);
    const invocationMessage = {
      replayProtection: {
        nonce: "0x01",
        queue: "0x00",
      },
      batch: [
        {
          authority: [signedDelegation, signedDelegation2],
          transaction: {
            to: myContract.address,
            gasLimit: "10000000000000000",
            data: desiredTx.data,
          },
        },
      ],
    };
    const typedInvocationMessage = createTypedMessage(
      myContract,
      invocationMessage,
      "Invocations",
      CONTRACT_NAME
    );
    const invocationSig = signTypedData_v4(
      Buffer.from(delegatePrivateKey),
      typedInvocationMessage
    );
    const signedInvocation = {
      signature: invocationSig,
      invocations: invocationMessage,
    };

    // A third party can submit the invocation method to the chain:
    const res = await myContract.connect(addr3).invoke([signedInvocation]);

    const proposal = await myContract.getProposal(proposalId);
    // Verify the change was made:
    expect(parseInt(proposal.forVoteCounter.toNumber())).to.equal(
      parseInt(proposalBefore.forVoteCounter.toNumber()) + 1
    );
  });
  it("Delegation with the Allowed Methods caveat enforcer to restrict what method User B can call", async () => {
    const [owner, addr1, addr2] = await ethers.getSigners();

    const { chainId } = await myContract.provider.getNetwork();
    const contractInfo = {
      chainId,
      verifyingContract: myContract.address,
      name: CONTRACT_NAME,
    };
    const util = generateUtil(contractInfo);

    const AllowListEnforcer = await ethers.getContractFactory(
      "AllowedMethodsEnforcer"
    );
    const allowListEnforcer = await AllowListEnforcer.deploy();
    await myContract.deployed();
    const desiredTx = await myContract.populateTransaction.vote(
      proposalId,
      true
    );

    //only fallback allowed
    const delegation = {
      delegate: addr1.address,
      authority:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      caveats: [
        {
          enforcer: allowListEnforcer.address,
          terms: "0x00000000",
        },
      ],
    };

    // Owner signs the delegation:
    const signedDelegation = util.signDelegation(
      delegation,
      ownerHexPrivateKey
    );

    // Delegate signs the invocation message:
    const delegatePrivateKey = fromHexString(account1PrivKey);
    const invocationMessage = {
      replayProtection: {
        nonce: "0x01",
        queue: "0x00",
      },
      batch: [
        {
          authority: [signedDelegation],
          transaction: {
            to: myContract.address,
            gasLimit: "10000000000000000",
            data: desiredTx.data,
          },
        },
      ],
    };
    const typedInvocationMessage = createTypedMessage(
      myContract,
      invocationMessage,
      "Invocations",
      CONTRACT_NAME
    );
    const invocationSig = signTypedData_v4(
      Buffer.from(delegatePrivateKey),
      typedInvocationMessage
    );
    const signedInvocation = {
      signature: invocationSig,
      invocations: invocationMessage,
    };

    try {
      const res = await myContract.connect(addr2).invoke([signedInvocation]);
    } catch (err) {
      // @ts-ignore
      expect(err.message).to.include(
        "VM Exception while processing transaction: reverted with reason string 'AllowedMethodsEnforcer:method-not-allowed"
      );
    }
  });

  it("Delegation with the Block Number caveat enforcer to restrict when User B can use the delegation", async () => {
    const [owner, addr1, addr2] = await ethers.getSigners();
    const { chainId } = await myContract.provider.getNetwork();
    const contractInfo = {
      chainId,
      verifyingContract: myContract.address,
      name: CONTRACT_NAME,
    };
    const util = generateUtil(contractInfo);

    const proposalBefore = await myContract.getProposal(proposalId);

    const BlockNumberBeforeEnforcer = await ethers.getContractFactory(
      "BlockNumberBeforeEnforcer"
    );
    const blockNumberBeforeEnforcer = await BlockNumberBeforeEnforcer.deploy();
    await myContract.deployed();
    const desiredTx = await myContract.populateTransaction.vote(
      proposalId,
      true
    );

    const delegation = {
      delegate: addr1.address,
      authority:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      caveats: [
        {
          enforcer: blockNumberBeforeEnforcer.address,
          terms:
            "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
      ],
    };

    // Owner signs the delegation:
    const signedDelegation = util.signDelegation(
      delegation,
      ownerHexPrivateKey
    );

    // Delegate signs the invocation message:
    const delegatePrivateKey = fromHexString(account1PrivKey);
    const invocationMessage = {
      replayProtection: {
        nonce: "0x01",
        queue: "0x00",
      },
      batch: [
        {
          authority: [signedDelegation],
          transaction: {
            to: myContract.address,
            gasLimit: "10000000000000000",
            data: desiredTx.data,
          },
        },
      ],
    };
    const typedInvocationMessage = createTypedMessage(
      myContract,
      invocationMessage,
      "Invocations",
      CONTRACT_NAME
    );
    const invocationSig = signTypedData_v4(
      Buffer.from(delegatePrivateKey),
      typedInvocationMessage
    );
    const signedInvocation = {
      signature: invocationSig,
      invocations: invocationMessage,
    };

    try {
      const res = await myContract.connect(addr2).invoke([signedInvocation]);
    } catch (err) {
      // @ts-ignore
      expect(err.message).to.include(
        "VM Exception while processing transaction: reverted with reason string 'BlockNumberBeforeEnforcer:expired-delegation"
      );
    }
  });
});

async function deployContract() {
  const YourContract = await ethers.getContractFactory(CONTRACT_NAME);

  const yourContract = await YourContract.deploy(CONTRACT_NAME, 1);
  return yourContract.deployed();
}

function fromHexString(hexString: string) {
  return new Uint8Array(
    // @ts-ignore
    hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
  );
}
