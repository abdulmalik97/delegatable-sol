// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "../Delegatable.sol";
import "../enforcers/BlockNumberBeforeEnforcer.sol";
import "../enforcers/AllowedMethodsEnforcer.sol";

contract DelegatableVoter is Ownable, Delegatable {
    constructor(string memory contractName, string memory version)
        Delegatable(contractName, version)
    {}

    using Counters for Counters.Counter;

    Counters.Counter private _proposalIds;
    uint256 counter;

    struct Proposal {
        string description;
        uint256 expirationBlock;
        mapping(address => bool) votes;
        uint256 voteCounter;
        uint256 forVoteCounter;
        bool isExecuted;
        bool result;
    }

    mapping(uint256 => Proposal) public _proposals;

    event ProposalCreated(
        uint256 proposalId,
        string description,
        uint256 expiration
    );

    function createProposal(string memory description, uint256 expirationBlock)
        public
        onlyOwner
    {
        _proposalIds.increment();
        uint256 newProposalId = _proposalIds.current();

        Proposal storage newProposal = _proposals[newProposalId];
        newProposal.description = description;
        newProposal.expirationBlock = expirationBlock;
        newProposal.isExecuted = false;
        newProposal.result = false;

        emit ProposalCreated(newProposalId, description, expirationBlock);
    }

    function vote(uint256 proposalId, bool forVote) public {
        require(
            proposalId <= _proposalIds.current(),
            "Proposal does not exist."
        );
        require(
            block.number <= _proposals[proposalId].expirationBlock,
            "Proposal has already expired."
        );
        require(
            !_proposals[proposalId].votes[msg.sender],
            "You have already voted on this proposal."
        );

        _proposals[proposalId].votes[msg.sender] = true;
        if (forVote) {
            _proposals[proposalId].forVoteCounter++;
        }
        _proposals[proposalId].voteCounter++;
    }

    function executeProposal(uint256 proposalId) public onlyOwner {
        require(
            proposalId <= _proposalIds.current(),
            "Proposal does not exist."
        );
        require(
            block.number > _proposals[proposalId].expirationBlock,
            "Proposal has not yet expired."
        );
        require(
            !_proposals[proposalId].isExecuted,
            "Proposal has already been executed."
        );

        _proposals[proposalId].isExecuted = true;

        // Let's assume the proposal is approved if more than 50% of the total voters vote in favor.
        // You might want to change this to fit your specific needs.
        if (
            _proposals[proposalId].voteCounter >
            (_proposals[proposalId].forVoteCounter / 2)
        ) {
            _proposals[proposalId].result = true;
        }
    }

    function proposalResult(uint256 proposalId)
        public
        view
        returns (string memory)
    {
        require(
            proposalId <= _proposalIds.current(),
            "Proposal does not exist."
        );
        require(
            _proposals[proposalId].isExecuted,
            "Proposal has not been executed yet."
        );

        if (_proposals[proposalId].result) {
            return "Approved";
        } else {
            return "Rejected";
        }
    }

    function _msgSender()
        internal
        view
        override(DelegatableCore, Context)
        returns (address sender)
    {
        if (msg.sender == address(this)) {
            bytes memory array = msg.data;
            uint256 index = msg.data.length;
            assembly {
                sender := and(
                    mload(add(array, index)),
                    0xffffffffffffffffffffffffffffffffffffffff
                )
            }
        } else {
            sender = msg.sender;
        }
        return sender;
    }

    function getProposal(uint256 proposalId)
        public
        view
        returns (
            string memory description,
            uint256 expirationBlock,
            uint256 voteCounter,
            uint256 forVoteCounter,
            bool isExecuted,
            bool result
        )
    {
        require(
            proposalId <= _proposalIds.current(),
            "Proposal does not exist."
        );

        Proposal storage proposal = _proposals[proposalId];

        return (
            proposal.description,
            proposal.expirationBlock,
            proposal.voteCounter,
            proposal.forVoteCounter,
            proposal.isExecuted,
            proposal.result
        );
    }
}
