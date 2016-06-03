import {EventEmitter} from 'events';
import log from './log';
import Process from './neovim/process';
import Screen from './neovim/screen';
import TextDisplay from './neovim/display';
import NeovimStore from './neovim/store';
import {
    updateFontPx,
    updateFontFace,
    updateScreenSize,
    updateLineHeight,
    disableAltKey,
    changeCursorDrawDelay,
    startBlinkCursor,
} from './neovim/actions';

let neovimModule: any;
try {
    const maybeNeovim = global.require('promised-neovim-client');
    neovimModule = maybeNeovim;
} catch(e) {
    const nowNeovim = global.require('electron').remote.require('promised-neovim-client');
    neovimModule = nowNeovim;
    log.warn('Using remote promised-neovim-client module');
}
const {Nvim} = neovimModule;
// import {Nvim} from 'promised-neovim-client';

export default class Neovim extends EventEmitter {
    process: Process;
    screen: Screen | TextDisplay;
    store: NeovimStore;

    constructor(
            command: string,
            argv: string[],
            font: string,
            font_size: number,
            line_height: number,
            disable_alt_key: boolean,
            draw_delay: number,
            blink_cursor: boolean
    ) {
        super();

        this.store = new NeovimStore();
        this.store.dispatcher.dispatch(updateLineHeight(line_height));
        this.store.dispatcher.dispatch(updateFontFace(font));
        this.store.dispatcher.dispatch(updateFontPx(font_size));
        this.store.dispatcher.dispatch(changeCursorDrawDelay(draw_delay));
        if (blink_cursor)
            this.store.dispatcher.dispatch(startBlinkCursor());
        if (disable_alt_key)
            this.store.dispatcher.dispatch(disableAltKey(true));

        this.process = new Process(this.store, command, argv);
    }

    attachDisplay(width: number, height: number, display: HTMLElement) {
        this.store.dispatcher.dispatch(updateScreenSize(width, height));
        this.screen = new TextDisplay(this.store, display);
        const {lines, cols} = this.store.size;
        this.process
            .attach(Math.max(lines, 10), Math.max(cols, 40))
            .then(() => {
                this.process.client.on('disconnect', () => this.emit('quit'));
                this.emit('process-attached');
            }).catch((err: any) => this.emit('error', err));
    }

    quit() {
        this.process.finalize();
    }

    getClient() {
        return this.process.client;
    }

    focus() {
        this.screen.focus();
    }

    // Note:
    // It is better to use 'argv' property of <neovim-client> for apps using Polymer.
    setArgv(argv: string[]) {
        if (!this.process.started) {
            throw new Error("Process is not attached yet.  Use 'process-attached' event to ensure to specify arguments.");
        }
        return this.process.client.command('args ' + argv.join(' '));
    }
}
