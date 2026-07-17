const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const path = require('path');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'eval-source-map',
  devServer: {
    port: parseInt(process.env.PORT, 10) || 9500, // [PLUGIN-SPECIFIC] dev port
    historyApiFallback: true,
    hot: true,
    proxy: [
      {
        context: ['/apache-superset/api'], // [PLUGIN-SPECIFIC] BFF proxy — must come before the general proxy
        target: 'http://localhost:3000',
        pathRewrite: { '^/apache-superset/api': '/api' },
      },
      {
        context: ['/apache-superset'], // [PLUGIN-SPECIFIC] must match route prefix
        target: 'http://localhost:8443',
        pathRewrite: { '^/apache-superset': '/apache-superset' },
      },
    ],
  },
  optimization: {
    runtimeChunk: false,
    splitChunks: false,
  },
});
