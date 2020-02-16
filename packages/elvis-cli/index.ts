#!/usr/bin/env ts-node
import crypto from "crypto";
import fs from "fs";
import path from "path";
import webpack from "webpack";
import webpackDevServer from "webpack-dev-server";

const cwd = process.cwd();
const HtmlPlugin = require("html-webpack-plugin");

interface IElvisPluginOptions {
  home?: string;
  pages?: string;
  ssr?: boolean;
  title?: string;
}

class ElvisPlugin {
  public static autoHome(): string {
    return [
      `import { Center, Elvis, Text } from "calling-elvis";\n`,
      "export default Center(",
      `  Text("Is anybody home?", {`,
      "    bold: true,",
      "    italic: true,",
      "    size: 6,",
      "  })",
      ");"
    ].join("\n");
  }

  public static autoOpts(root: string): IElvisPluginOptions {
    let opts: IElvisPluginOptions = {
      home: "index",
      pages: ".",
      ssr: false,
      title: "Calling Elvis",
    }

    // locate pages entry
    if (fs.existsSync(path.resolve(root, "pages"))) {
      opts.pages = "pages";
    }

    // generate home
    const pagesDir = path.resolve(root, opts.pages);
    const pages = ElvisPlugin.getPages(
      fs.readdirSync(pagesDir)
    ).map((f) => f.slice(0, f.lastIndexOf(".")));

    if (pages.indexOf("index") > -1) {
      opts.home = "index";
    } else if (pages.indexOf("home") > -1) {
      opts.home = "home";
    } else if (pages.length > 0) {
      opts.home = pages[0];
    } else {
      fs.writeFileSync(
        path.resolve(pagesDir, "index.js"),
        ElvisPlugin.autoHome()
      );
    }

    return opts;
  }

  public static getPages(files?: string[]): string[] {
    return files.filter((s) => {
      return (s.indexOf(".elvis.js") < 0) && (s.endsWith(".js") || s.endsWith(".ts"));
    });
  }

  public static locate(cur: string): string {
    if (cur === "/") {
      return "";
    }

    const files: string[] = fs.readdirSync(cur);
    if (files.indexOf(".elvis.js") === -1) {
      return ElvisPlugin.locate(path.resolve(cur, ".."));
    }

    return cur;
  }

  public static ref(path: string): string {
    return crypto.createHmac(
      "md5", "elvis-md5"
    ).update(
      fs.readFileSync(path)
    ).digest("hex");
  }

  options: IElvisPluginOptions;
  ptr: string;
  root: string;

  constructor(options?: IElvisPluginOptions) {
    // locate root path
    let root = ElvisPlugin.locate(cwd);
    if (root === "") {
      root = cwd;
      this.root = cwd;
    } else {
      this.root = root;
    }

    // init options from plugn entry
    this.options = Object.assign(
      ElvisPlugin.autoOpts(root),
      options
    );

    // update local configurations
    const conf = path.resolve(this.root, ".elvis.js");
    if (fs.existsSync(conf)) {
      this.options = Object.assign(this.options, import(conf));
    } else {
      const opts = JSON.stringify(this.options, null, 2);
      fs.writeFileSync(conf, [
        "/* elvis config file */",
        `module.exports = ${opts}`,
      ].join("\n"));
    }
  }

  // apply plugin to webpack
  public apply(compiler: webpack.Compiler): void {
    compiler.hooks.afterPlugins.tap("elvis-webpack-plugin", (compiler) => {
      if (this.options.ssr) {
        this.tunnel(compiler, 0);
      } else {
        this.tunnel(compiler, 1);
      }
    });
  }

  // single page application handler
  private spa(compiler: webpack.Compiler): void {
    let webpackOpts = compiler.options;
    if (!webpackOpts.devServer.historyApiFallback) {
      webpackOpts.devServer.historyApiFallback = true;
    }

    const calling = path.resolve(__dirname, "etc/calling.js");
    const pagesDir = path.resolve(this.root, this.options.pages);
    const pages = fs.readdirSync(pagesDir);
    const home = this.options.home[0].toUpperCase() + this.options.home.slice(1);

    let lines = [
      "/* elvis spa caller */",
      `import { Router, Elvis } from "calling-elvis"`,
      ElvisPlugin.getPages(pages).map((page) => {
        let widget = page[0].toUpperCase() + page.slice(1);
        let relative = path.relative(path.dirname(calling), `${pagesDir}/${page}`);
        relative = relative.slice(0, relative.lastIndexOf("."));
        return `import ${widget.slice(0, widget.lastIndexOf("."))} from "${relative}";`;
      }).join("\n"),
      "\nnew Elvis({",
      `  home: ${home},`,
      "  router: new Router({",
      ElvisPlugin.getPages(pages).map((page) => {
        if (page.indexOf(home.toLowerCase()) < 0) {
          page = page.slice(0, page.lastIndexOf("."));
          let widget = page[0].toUpperCase() + page.slice(1);
          return `    "${page}": ${widget},`;
        }
      }).join("\n"),
      "  }),",
      "}).calling();",
    ].join("\n");

    if (!fs.existsSync(calling) || (crypto.createHmac(
      "md5", "elvis-md5"
    ).update(lines).digest("hex") != ElvisPlugin.ref(calling))) {
      fs.writeFileSync(calling, lines);
    }
  }

  // server side rendering handler
  private ssr(compiler: webpack.Compiler): void {
    console.log(compiler);
  }

  // mode tunnel
  private tunnel(
    compiler: webpack.Compiler,
    adapter: number,
  ): void {
    let plugins = compiler.options.plugins;

    // patch for HTMLWebpackPlugin
    for (const i in plugins) {
      if (plugins[i] instanceof HtmlPlugin) {
        type HtmlWebpackPlugin = typeof HtmlPlugin;
        let hp: HtmlWebpackPlugin = plugins[i];
        hp.options.title = this.options.title;
      }
    }

    if (adapter === 0) {
      this.ssr(compiler);
    } else {
      this.spa(compiler);
    }
  }
}

/* webpack configs */
function pack(code: number): void {
  const etc = path.resolve(__dirname, "etc");
  const bootstrap = path.resolve(etc, "bootstrap.js");
  if (!fs.existsSync(bootstrap)) {
    if (!fs.existsSync(etc)) {
      fs.mkdirSync(etc);
    }
    fs.writeFileSync(bootstrap, `import("./calling");`);
  }

  let mode = "development";
  if (code !== 0) {
    mode = "production";
  }

  const config: any = {
    devServer: {
      hot: true,
      port: 1439
    },
    devtool: "inline-source-map",
    entry: bootstrap,
    mode: mode,
    output: {
      filename: "elvis.bundle.js",
      path: path.resolve(cwd, ".elvis"),
    },
    plugins: [
      new HtmlPlugin(),
      new ElvisPlugin(),
    ],
    resolve: {
      extensions: [".ts", ".js", ".wasm"],
    },
  };

  // webpack
  const compiler = webpack(config);
  const devServerOptions = Object.assign({}, config.devServer);

  // check mode
  if (code === 0) {
    const server = new webpackDevServer(compiler, devServerOptions);
    server.listen(devServerOptions.port, "127.0.0.1", () => { });
  } else {
    compiler.run((err, stats) => {
      if (err != null) {
        console.error(`error: ${stats}`);
        process.exit(1);
      }
    });
  }
}

/* simple cli program */
class Program {
  static run(): void {
    const argv = process.argv;
    if (argv.length == 2) {
      Program.help();
      process.exit(0);
    }

    switch (argv[2].trim()) {
      case 'build':
        pack(1);
        break;
      case 'dev':
        pack(0);
        break;
      default:
        Program.help();
        break;
    }
  }

  static help() {
    let conf: any = {};
    const pj = path.resolve(__dirname, "./package.json");
    if (fs.existsSync(pj)) {
      conf = require(pj);
    } else {
      conf = require(path.resolve(__dirname, "../package.json"));
    }

    console.log([
      `${conf.name} ${conf.version}\n`,
      `${conf.description}\n\n`,
      "USAGE: \n",
      "    elvis   [SUBCOMMANND]\n\n",
      "SUBCOMMANDS: \n",
      "    build   Build your satellite!\n",
      "    doc     Serve the Elvis Book!\n",
      "    dev     Calling Elvis!\n",
      "    help    Prints this Message!"
    ].join(""));
  }
}

// main
(function() {
  Program.run();
})();