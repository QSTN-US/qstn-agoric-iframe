const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'agoric-sandbox.[contenthash].js',
    // Use relative path for local dev, will work with jsDelivr too
    publicPath: './',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
          },
        },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/template.html',
      filename: 'agoric-sandbox.html',
      inject: 'body', // Inject script tag at end of body
      scriptLoading: 'blocking', // Use blocking script loading for reliability
      minify: {
        removeComments: true,
        collapseWhitespace: true,
      },
    }),
  ],
  resolve: {
    fallback: {
      buffer: require.resolve('buffer/'),
      crypto: false,
      stream: false,
      assert: false,
      http: false,
      https: false,
      os: false,
      url: false,
    },
  },
  devServer: {
    port: 8080,
    static: {
      directory: path.join(__dirname, 'dist'),
    },
    open: true,
  },
  performance: {
    maxAssetSize: 5000000, // 5MB - Agoric bundle is large
    maxEntrypointSize: 5000000,
  },
};
