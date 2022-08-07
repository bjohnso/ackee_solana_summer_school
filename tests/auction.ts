import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { Auction } from "../target/types/auction";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import {expect, use} from "chai";

describe("auction", () => {
    // Configure the client to use the local cluster.
    anchor.setProvider(anchor.Provider.env());

    const program = anchor.workspace.Auction as Program<Auction>;
    const state: anchor.web3.Keypair = anchor.web3.Keypair.generate();
    const seller = anchor.web3.Keypair.generate();

    const bidders = [
        {bidder: anchor.web3.Keypair.generate(), bid: 0.1}, // refund bidder
        {bidder: anchor.web3.Keypair.generate(), bid: 0.5}, // highest bidder
        {bidder: anchor.web3.Keypair.generate(), bid: 0.2}, // refund bidder
        {bidder: anchor.web3.Keypair.generate(), bid: 0.005}, // invalid bidder
    ];

    before(async function () {
        await (program.provider as anchor.Provider).connection.requestAirdrop(seller.publicKey, LAMPORTS_PER_SOL)
        await new Promise(resolve => setTimeout(resolve, 1000));

        for (const b of bidders) {
            await (program.provider as anchor.Provider).connection.requestAirdrop(b.bidder.publicKey, LAMPORTS_PER_SOL)
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    });

    it("is initialized!", async () => {
        const [treasuryPDA, bump] = await PublicKey
            .findProgramAddress(
                [anchor.utils.bytes.utf8.encode("treasury")],
                program.programId
            );

        const timestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 5); // 15 seconds from now;

        await program.methods
            .initialize(timestamp)
            .accounts({
                state: state.publicKey,
                initializer: seller.publicKey,
                treasury: treasuryPDA,
                systemProgram: SystemProgram.programId,
            })
            .signers([state, seller])
            .rpc();

        let treasuryState = await program.account.treasury.fetch(treasuryPDA);
        let auctionState = await program.account.auctionState.fetch(state.publicKey);

        expect(treasuryState.bump).to.equal(bump);
        expect(auctionState.auctionDuration.toString()).to.equal(timestamp.toString());
        expect(auctionState.auctionStage).to.equal(0)
    });

    it("has valid bids", async () => {
        const [treasuryPDA, treasuryBump] = await PublicKey
            .findProgramAddress(
                [anchor.utils.bytes.utf8.encode("treasury")],
                program.programId
            );

        const validBidders = [bidders[0], bidders[1], bidders[2]];

        for (const bidder of validBidders) {
            const [bidderPDA, bidderBump] = await PublicKey
                .findProgramAddress(
                    [
                        anchor.utils.bytes.utf8.encode("bidder"),
                        bidder.bidder.publicKey.toBytes()
                    ],
                    program.programId
                );

            const bid = new anchor.BN(LAMPORTS_PER_SOL * bidder.bid)

            await program.methods
                .bid(bid)
                .accounts({
                    state: state.publicKey,
                    user: bidder.bidder.publicKey,
                    treasury: treasuryPDA,
                    bidder: bidderPDA,
                    systemProgram: SystemProgram.programId,
                })
                .signers([bidder.bidder])
                .rpc();

            let bidderState = await program.account.bidder.fetch(bidderPDA);
            let bidderStateBid = new anchor.BN(bidderState.bid)

            const balance = await (program.provider as anchor.Provider).connection.getBalance(treasuryPDA);

            expect(bidderState.bump).to.equal(bidderBump);
            expect(bidderState.bidder.toBase58()).to.equal(bidder.bidder.publicKey.toBase58())
            expect(bidderStateBid.toString()).to.equal(bid.toString());
        }
    });

    it("is invalid bid", async () => {
        const [treasuryPDA, treasuryBump] = await PublicKey
            .findProgramAddress(
                [anchor.utils.bytes.utf8.encode("treasury")],
                program.programId
            );

        const invalidBidder = bidders[3];

        const [bidderPDA, bidderBump] = await PublicKey
            .findProgramAddress(
                [
                    anchor.utils.bytes.utf8.encode("bidder"),
                    invalidBidder.bidder.publicKey.toBytes()
                ],
                program.programId
            );

        const bid = new anchor.BN(LAMPORTS_PER_SOL * invalidBidder.bid)

        let error = null;

        try {
            await program.methods
                .bid(bid)
                .accounts({
                    state: state.publicKey,
                    user: invalidBidder.bidder.publicKey,
                    treasury: treasuryPDA,
                    bidder: bidderPDA,
                    systemProgram: SystemProgram.programId,
                })
                .signers([invalidBidder.bidder])
                .rpc()
        } catch (e) {
            error = e.message
        }

        expect(error).to.equal("6000: Invalid bid")
    });

    it("is invalid time to bid", async () => {
        await new Promise(resolve => setTimeout(resolve, 5000));

        const [treasuryPDA, treasuryBump] = await PublicKey
            .findProgramAddress(
                [anchor.utils.bytes.utf8.encode("treasury")],
                program.programId
            );

        const invalidBidder = bidders[3];

        const [bidderPDA, bidderBump] = await PublicKey
            .findProgramAddress(
                [
                    anchor.utils.bytes.utf8.encode("bidder"),
                    invalidBidder.bidder.publicKey.toBytes()
                ],
                program.programId
            );

        const bid = new anchor.BN(LAMPORTS_PER_SOL * invalidBidder.bid)

        let error = null;

        try {
            await program.methods
                .bid(bid)
                .accounts({
                    state: state.publicKey,
                    user: invalidBidder.bidder.publicKey,
                    treasury: treasuryPDA,
                    bidder: bidderPDA,
                    systemProgram: SystemProgram.programId,
                })
                .signers([invalidBidder.bidder])
                .rpc()
        } catch (e) {
            error = e.message
        }

        expect(error).to.equal("6001: Invalid time")
    });

    it("has highest bid", async () => {
        const highestBidder = bidders[1];

        const [bidderPDA, bidderBump] = await PublicKey
            .findProgramAddress(
                [
                    anchor.utils.bytes.utf8.encode("bidder"),
                    highestBidder.bidder.publicKey.toBytes()
                ],
                program.programId
            );

        let bidderState = await program.account.bidder.fetch(bidderPDA);
        let bidderStateBid = new anchor.BN(bidderState.bid)

        expect(bidderStateBid.toString()).to.equal(new anchor.BN(highestBidder.bid * LAMPORTS_PER_SOL).toString())
        expect(bidderState.bidder.toBase58()).to.equal(highestBidder.bidder.publicKey.toBase58())
    });

    it("did pay auctioneer", async () => {
        const initBalance = await (program.provider as anchor.Provider).connection.getBalance(seller.publicKey);
        await new Promise(resolve => setTimeout(resolve, 5000));

        const [treasuryPDA, bump] = await PublicKey
            .findProgramAddress(
                [anchor.utils.bytes.utf8.encode("treasury")],
                program.programId
            );

        await program.methods
            .endAuction()
            .accounts({
                state: state.publicKey,
                initializer: seller.publicKey,
                treasury: treasuryPDA,
                systemProgram: SystemProgram.programId,
            })
            .signers([seller])
            .rpc();

        let auctionState = await program.account.auctionState.fetch(state.publicKey);
        const balance = await (program.provider as anchor.Provider).connection.getBalance(seller.publicKey);

        expect(balance).to.greaterThan(initBalance);
        expect(auctionState.auctionStage).to.equal(1)
    });

    it("did refund bidders", async () => {
        const [treasuryPDA, treasuryBump] = await PublicKey
            .findProgramAddress(
                [anchor.utils.bytes.utf8.encode("treasury")],
                program.programId
            );

        const validBidders = [bidders[0], bidders[2]];

        for (const bidder of validBidders) {
            const initBalance = await (program.provider as anchor.Provider).connection.getBalance(bidder.bidder.publicKey);

            const [bidderPDA, bidderBump] = await PublicKey
                .findProgramAddress(
                    [
                        anchor.utils.bytes.utf8.encode("bidder"),
                        bidder.bidder.publicKey.toBytes()
                    ],
                    program.programId
                );

            await program.methods
                .refund()
                .accounts({
                    state: state.publicKey,
                    user: bidder.bidder.publicKey,
                    treasury: treasuryPDA,
                    bidder: bidderPDA,
                    systemProgram: SystemProgram.programId,
                })
                .signers([bidder.bidder])
                .rpc();

            const balance = await (program.provider as anchor.Provider).connection.getBalance(seller.publicKey);
            expect(balance).to.greaterThan(initBalance);
        }
    });
});
