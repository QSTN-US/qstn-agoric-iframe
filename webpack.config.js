const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const fs = require('fs');

// Custom plugin to inline JavaScript into HTML
class InlineScriptPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap('InlineScriptPlugin', (compilation) => {
      HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tapAsync(
        'InlineScriptPlugin',
        (data, callback) => {
          const { html, plugin } = data;

          // Find script tags
          const scriptRegex = /<script\s+src="([^"]+)"[^>]*><\/script>/g;
          let newHtml = html;
          let match;

          while ((match = scriptRegex.exec(html)) !== null) {
            const scriptSrc = match[1];
            const scriptFilename = scriptSrc.replace('./', '');

            // Get the JS content from compilation
            const jsAsset = compilation.assets[scriptFilename];
            if (jsAsset) {
              const jsContent = jsAsset.source();
              // Replace script tag with inline script
              newHtml = newHtml.replace(
                match[0],
                `<script>${jsContent}</script>`
              );
              console.log(`[InlineScriptPlugin] Inlined ${scriptFilename} (${(jsContent.length / 1024).toFixed(0)}KB)`);

              // Delete the separate JS file since it's now inlined
              delete compilation.assets[scriptFilename];
              delete compilation.assets[scriptFilename + '.LICENSE.txt'];
            }
          }

          data.html = newHtml;
          callback(null, data);
        }
      );
    });
  }
}

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
      inject: 'body',
      scriptLoading: 'blocking',
      minify: false, // Disable minify for debugging
    }),
    new InlineScriptPlugin(), // Inline the JavaScript after HTML is generated
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
