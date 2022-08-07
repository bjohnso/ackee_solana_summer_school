use anchor_lang::{
    prelude::*,
    solana_program::clock::UnixTimestamp,
};
use anchor_lang::solana_program::clock;

declare_id!("AcLrVrFyxpguUKDLLwxevDviGqzimyU4ynXyVZggc8oH");

#[program]
pub mod auction {
    use anchor_lang::solana_program::native_token::sol_to_lamports;
    use anchor_lang::solana_program::program::{invoke, invoke_signed};
    use anchor_lang::solana_program::{clock, system_instruction};
    use anchor_lang::solana_program::system_instruction::SystemInstruction::Transfer;
    use super::*;
    /// Creates and initialize a new state of our program
    pub fn initialize(ctx: Context<Initialize>, auction_duration: u64, /* optional parameters */) -> Result<()> {

        require!(auction_duration > now_ts().unwrap(), AuctionError::InvalidAuctionTimeError);

        let state = &mut ctx.accounts.state;

        state.auction_stage = AuctionStage::Open.to_u8();
        state.seller = *ctx.accounts.initializer.key;
        state.auction_duration = auction_duration;

        let treasury = &mut ctx.accounts.treasury;
        treasury.bump = *ctx.bumps.get("treasury").unwrap();
        Ok(())
    }
    /// Bid
    pub fn bid(ctx: Context<Bid>, lamports: u64) -> Result<()> {
        let state = &mut ctx.accounts.state;
        let treasury  = &mut ctx.accounts.treasury;
        let bidder = &mut ctx.accounts.bidder;
        let user = &mut ctx.accounts.user;
        let system_program = &mut ctx.accounts.system_program;

        require!(now_ts().unwrap() < state.auction_duration, AuctionError::InvalidAuctionTimeError);
        require!(lamports >= sol_to_lamports(0.01), AuctionError::InvalidBidError);

        invoke(
            &system_instruction::transfer(
                &user.to_account_info().key(),
                &treasury.to_account_info().key(),
                lamports
            ),
            &[
                user.to_account_info().clone(),
                treasury.to_account_info().clone(),
                system_program.to_account_info().clone()
            ],
        )?;

        bidder.bump = *ctx.bumps.get("bidder").unwrap();
        bidder.bidder = *ctx.accounts.user.key;
        bidder.bid = lamports;

        if state.highest_bid < bidder.bid {
            state.highest_bid = bidder.bid;
            state.highest_bidder = bidder.bidder;
        }

        Ok(())
    }
    /// After an auction ends (determined by `auction_duration`), a seller can claim the
    /// heighest bid by calling this instruction
    pub fn end_auction(ctx: Context<EndAuction>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        let treasury  = &mut ctx.accounts.treasury;
        let initializer = &mut ctx.accounts.initializer;

        require!(state.seller == initializer.key(), AuctionError::InvalidSigner);
        require!(now_ts().unwrap() > state.auction_duration, AuctionError::InvalidAuctionTimeError);
        require!(state.auction_stage == AuctionStage::Open.to_u8(), AuctionError::InvalidBidError);
        require!(state.highest_bid > 0, AuctionError::InvalidBidError);
        require!(**treasury.to_account_info().lamports.borrow() >= state.highest_bid, AuctionError::InvalidBalanceError);

        **treasury.to_account_info().try_borrow_mut_lamports()? -= state.highest_bid;
        **initializer.to_account_info().try_borrow_mut_lamports()? += state.highest_bid;

        state.auction_stage = AuctionStage::Closed.to_u8();

        Ok(())
    }
    /// After an auction ends (the initializer/seller already received the winning bid), 
    /// the unsuccessfull bidders can claim their money back by calling this instruction
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        let treasury  = &mut ctx.accounts.treasury;
        let bidder = &mut ctx.accounts.bidder;
        let user = &mut ctx.accounts.user;

        require!(now_ts().unwrap() > state.auction_duration, AuctionError::InvalidAuctionTimeError);
        require!(state.auction_stage == AuctionStage::Closed.to_u8(), AuctionError::InvalidBidError);
        require!(bidder.bidder == user.key(), AuctionError::InvalidSigner);
        require!(bidder.bid > 0, AuctionError::InvalidBidError);
        require!(user.key() != state.highest_bidder, AuctionError::InvalidSigner);

        **treasury.to_account_info().try_borrow_mut_lamports()? -= bidder.bid;
        **user.to_account_info().try_borrow_mut_lamports()? += bidder.bid;

        bidder.bid = 0;

        Ok(())
    }
}

fn now_ts() -> Result<u64> {
    Ok(clock::Clock::get()?.unix_timestamp.try_into().unwrap())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer=initializer,
        space=32+32+64+64+8+8
    )]
    pub state: Account<'info, AuctionState>,

    #[account(
        init,
        payer=initializer,
        space=8+8,
        seeds=[b"treasury".as_ref()],
        bump
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(mut)]
    pub initializer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Bid<'info> {
    #[account(mut)]
    pub state: Account<'info, AuctionState>,

    #[account(
        mut,
        seeds=[b"treasury".as_ref()],
        bump
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(
        init,
        payer=user,
        space=8+32+64+8,
        seeds=[b"bidder".as_ref(), user.key.as_ref()],
        bump
    )]
    pub bidder: Account<'info, Bidder>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EndAuction<'info> {
    #[account(mut)]
    pub state: Account<'info, AuctionState>,

    #[account(
        mut,
        seeds=[b"treasury".as_ref()],
        bump
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(mut)]
    pub initializer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub state: Account<'info, AuctionState>,

    #[account(
        mut,
        seeds=[b"treasury".as_ref()],
        bump
    )]
    pub treasury: Account<'info, Treasury>,

    #[account(
        mut,
        seeds=[b"bidder".as_ref(), user.key.as_ref()],
        bump
    )]
    pub bidder: Account<'info, Bidder>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct AuctionState {
    pub seller: Pubkey, // 32 bytes
    pub auction_duration: u64, // 64 bytes
    pub highest_bidder: Pubkey, // 32 bytes
    pub highest_bid: u64, // 64 bytes
    pub auction_stage: u8, // 8 bytes
}

#[account]
pub struct Treasury {
    pub bump: u8, // 8 bytes
}

#[account]
pub struct Bidder {
    pub bump: u8, // 8 bytes
    pub bidder: Pubkey, // 32 bytes
    pub bid: u64 // 64 bytes
}

#[derive(Clone, Copy, PartialEq)]
pub enum AuctionStage {
    Open = 0,
    Closed = 1,
}

impl AuctionStage {
    fn to_u8(&self) -> u8 {
        *self as u8
    }

    fn from_u8(stage: u8) -> Option<AuctionStage> {
        match stage {
            0 => Some(AuctionStage::Open),
            1 => Some(AuctionStage::Closed),
            _ => None
        }
    }
}

#[error_code]
pub enum AuctionError {
    #[msg("Invalid bid")]
    InvalidBidError,
    #[msg("Invalid time")]
    InvalidAuctionTimeError,
    #[msg("Invalid balance")]
    InvalidBalanceError,
    #[msg("Invalid auction state")]
    InvalidAuctionState,
    #[msg("Invalid signer")]
    InvalidSigner
}
