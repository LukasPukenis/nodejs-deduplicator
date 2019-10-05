// docs: http://webpack.github.io/docs/

const webpack = require("webpack");
var HappyPack = require("happypack");
const minimist = require("minimist");
const pkg = require("./package.json");
var ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");
const path = require("path");
/* eslint-disable no-magic-numbers */
const args = minimist(process.argv.slice(2));
/* eslint-enable no-magic-numbers */

const ENV = args.environment || process.env.WEBPACK_ENV || "local";
const IS_DEV = ENV === "local" || ENV === "dev";
const IS_PROD = !IS_DEV;

const plugins = [
	new webpack.DefinePlugin({ ENV: JSON.stringify(ENV) }),
	new webpack.DefinePlugin({ IS_DEV: IS_DEV }),
	new webpack.DefinePlugin({ IS_PROD: IS_PROD })
];

plugins.push(
	new HappyPack({
		id: "ts",
		threads: 2,
		loaders: [
			{
				path: "ts-loader",
				query: { happyPackMode: true }
			}
		]
	})
);

plugins.push(new ForkTsCheckerWebpackPlugin({ checkSyntacticErrors: true }));

module.exports = {
	watch: true,
	mode: IS_DEV ? "development" : "production",
	context: __dirname,
	entry: {
		index: "./src/index.ts"
	},
	output: {
		path: path.join(__dirname, "dist/js/"),
		publicPath: "dist/js/",
		filename: "[name].js"
	},
	resolve: {
		extensions: [".ts", ".js"]
	},
	optimization: {
		minimize: !IS_DEV,
		splitChunks: {
			chunks: "async",
			minSize: 30000,
			maxSize: 0,
			minChunks: 1,
			maxAsyncRequests: 5,
			maxInitialRequests: 3,
			automaticNameDelimiter: "~",
			name: true,
			cacheGroups: {
				vendors: {
					test: /[\\/]node_modules[\\/]/,
					priority: -10
				},
				default: {
					minChunks: 2,
					priority: -20,
					reuseExistingChunk: true
				}
			}
		}
	},
	module: {
		rules: [
			{
				test: /\.ts$|\.js$/,
				exclude: [__dirname +"dist", __dirname +"libs", __dirname +"node_modules"],
				loader: "happypack/loader?id=ts"
			}
		]
	},
	devServer: {
		headers: {
			"Access-Control-Allow-Origin": "*"
			// 'Access-Control-Allow-Origin': 'http://10.0.2.2:8181' // swap this in for testing exemplar site on IE VMs
		},
		disableHostCheck: true
	},
	target: 'node',
	plugins: plugins,
	devtool: "source-map"
};