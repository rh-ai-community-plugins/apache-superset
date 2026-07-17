# Contributing

Thank you for your interest in the Apache Superset community plugin for Red Hat OpenShift AI Dashboard.

## Branching Model

- **`main`** — release branch. Always reflects the latest released version. Do not push directly.
- **`dev`** — development branch. All feature branches are created from `dev` and merged back into `dev` via pull request.
- To release, open a PR from `dev` to `main`.

## How to Contribute

1. Fork the repository and create a feature branch from `dev`.
2. Make your changes and ensure tests and lint pass:

   ```bash
   npm test
   npm run lint
   ```

3. Submit a pull request targeting the `dev` branch with a clear description of the change.

## Reporting Issues

Please use [GitHub Issues](https://github.com/rh-ai-community-plugins/apache-superset/issues) to report bugs or suggest improvements.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
