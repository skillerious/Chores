# Accounts Data Lake

This directory is managed entirely by the Family Chores app. Each authenticated device writes chore and payout activity as JSON blobs via the GitHub API.

## Files
- `ledger.json`: Canonical data store for the household.
- `ledger.example.json`: Human-readable template for initializing new repos.

The UI will automatically create `ledger.json` with the proper schema if it does not already exist.
