import webpack from 'webpack';
import chalk from 'chalk';
import _ from 'lodash';
import logUpdate from 'log-update';
import env from 'std-env';
import consola from 'consola';
import prettyTime from 'pretty-time';

import Profile from './profile';
import {
  BULLET,
  parseRequest,
  formatRequest,
  renderBar,
  formatStats,
  colorize,
  ellipsisLeft,
} from './utils';

const sharedState = {};

const defaults = {
  name: 'webpack',
  color: 'green',
  profile: false,
  compiledIn: true,
  done: null,
  minimal: env.minimalCLI,
  stream: null,
};

const hasRunning = () =>
  Object.keys(sharedState)
    .map((e) => sharedState[e])
    .find((s) => s.isRunning);

const $logUpdate = logUpdate.create(process.stderr, {
  showCursor: false,
});

export default class WebpackBarPlugin extends webpack.ProgressPlugin {
  constructor(options) {
    super();

    this.options = Object.assign({}, defaults, options);

    // this.handler will be called by webpack.ProgressPlugin
    this.handler = (percent, msg, ...details) =>
      this.updateProgress(percent, msg, details);

    this._render = _.throttle(this.render, 100);

    this.logUpdate = this.options.logUpdate || $logUpdate;

    if (!this.state) {
      sharedState[this.options.name] = {
        isRunning: false,
        color: this.options.color,
        profile: this.options.profile ? new Profile(this.options.name) : null,
      };
    }
  }

  get state() {
    return sharedState[this.options.name];
  }

  get stream() {
    return this.options.stream || process.stderr;
  }

  apply(compiler) {
    super.apply(compiler);

    const hook = (stats) => {
      this.state.stats = stats;
      if (!hasRunning()) {
        this.logUpdate.clear();
        this.done();
      }
    };

    if (compiler.hooks) {
      compiler.hooks.done.tap('WebpackBar', hook);
    } else {
      compiler.plugin('done', hook);
    }
  }

  done() {
    if (this.options.profile) {
      const stats = this.state.profile.getStats();
      const statsStr = formatStats(stats);
      this.stream.write(`\n${statsStr}\n`);
    }

    if (typeof this.options.done === 'function') {
      this.options.done(sharedState, this);
    }
  }

  updateProgress(percent, msg, details = []) {
    const progress = Math.floor(percent * 100);
    const isRunning = progress < 100;

    const wasRunning = this.state.isRunning;

    Object.assign(this.state, {
      details,
      progress,
      msg: isRunning && msg ? msg : '',
      request: parseRequest(details[2]),
      isRunning,
    });

    if (!wasRunning && isRunning) {
      // Started
      delete this.state.stats;
      this.state.start = process.hrtime();
      if (this.options.minimal) {
        consola.info(`Compiling ${this.options.name}`);
      }
    } else if (wasRunning && !isRunning) {
      // Finished
      const time = process.hrtime(this.state.start);
      if (this.options.minimal) {
        consola.success(`Compiled ${this.options.name} in ${prettyTime(time)}`);
      } else {
        this.logUpdate.clear();
        if (this.options.compiledIn) {
          consola.success(
            `${this.options.name} compiled in ${prettyTime(time, 'ms')}`
          );
        }
      }
      delete this.state.start;
    }

    if (this.options.profile) {
      this.state.profile.onRequest(this.state.request);
    }

    this._render();
  }

  render() {
    if (this.options.minimal) {
      return;
    }

    const columns = this.stream.columns || 80;

    const stateLines = _.sortBy(Object.keys(sharedState)).map((name) => {
      const state = sharedState[name];
      const color = colorize(state.color);

      if (!state.isRunning) {
        const color2 = state.progress === 100 ? color : chalk.grey;
        return color2(`${BULLET} ${name}\n`);
      }

      return `${[
        color(BULLET),
        color(name),
        renderBar(state.progress, state.color),
        state.msg,
        `(${state.progress || 0}%)`,
        chalk.grey((state.details && state.details[0]) || ''),
        chalk.grey((state.details && state.details[1]) || ''),
      ].join(' ')}\n ${
        state.request
          ? chalk.grey(ellipsisLeft(formatRequest(state.request), columns - 2))
          : ''
      }\n`;
    });

    if (hasRunning()) {
      const title = chalk.underline.blue('Compiling');
      const log = `\n${title}\n\n${stateLines.join('\n')}`;
      this.logUpdate(log);
    }
  }
}
