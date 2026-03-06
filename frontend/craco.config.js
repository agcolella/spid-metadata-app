module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // Trova il CssMinimizerPlugin e disabilita svgo
      webpackConfig.optimization.minimizer = webpackConfig.optimization.minimizer.map(
        (plugin) => {
          if (plugin.constructor.name === 'CssMinimizerPlugin') {
            plugin.options.minimizerOptions = {
              preset: ['default', { svgo: false }]
            };
          }
          return plugin;
        }
      );
      return webpackConfig;
    }
  }
};
