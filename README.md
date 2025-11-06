# astr-issue-guard

> A GitHub App built with [Probot](https://github.com/probot/probot) that AI-powered GitHub App that automatically moderates Issues.

Heuristic rules are inspired by the [amis issue spam filter workflow](https://github.com/baidu/amis/blob/master/.github/workflows/issue-spam-filter.yml).

## Setup

```sh
# Install dependencies
npm install

# Run the bot
npm start
```

## Docker

```sh
# 1. Build container
docker build -t astr-issue-guard .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> astr-issue-guard
```

## Contributing

If you have suggestions for how astr-issue-guard could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2025 Raven95676
