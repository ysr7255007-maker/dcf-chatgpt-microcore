//! Conventional database baseline for the leverage-v1 comparison:
//! SQLite structured facts + FTS5 trigram candidate index + zstd 256 KiB text
//! blocks + row/span mapping. FTS5 only narrows candidate records; exact
//! canonical byte spans come from overlapping byte search on the canonical
//! bytes decompressed from the independent zstd block store.

pub mod protocol;
pub mod schema;
pub mod search;
pub mod store;

pub use schema::create_schema;
pub use store::TextBlockStore;
