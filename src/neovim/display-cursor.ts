import {EventEmitter} from 'events';
import NeovimStore from './store';
import TextDisplay from './display';
import log from '../log';
import {dragEnd} from './actions';

/* Note: [LEFT, TOP] == [X, Y] */

function _ (msg: any) {
    return JSON.stringify(msg);
}
function create (tag = 'div', ...classList: string[]) {
    const newElement = document.createElement(tag);
    newElement.classList.add('neovim-editor', ...classList);
    return newElement;
}
function addClass (element: HTMLElement, ...classes: string[]): HTMLElement {
    element.classList.add(...classes);
    return element;
}

type Position = {line: number, col: number}

export default class DisplayCursor {
    public element: HTMLElement;
    // ---
    private bufferedPosition: Position;
    private renderDelay: any;
    private blinkDelay: any;

    constructor(private store: NeovimStore,
                private display: TextDisplay) {
        this.bufferedPosition = null;
        this.renderDelay      = null;
        this.blinkDelay       = null;

        this.store.on('cursor',               this.updatePosition.bind(this));
        this.store.on('mode',                 this.updateMode.bind(this));
        this.store.on('input',                this.resetBlink.bind(this));
        this.store.on('focus-changed',        this.updateFocus.bind(this));
        this.store.on('font-size-changed',    this.updateSize.bind(this));
        this.store.on('blink-cursor-started', this.startBlink.bind(this));
        this.store.on('blink-cursor-stopped', this.stopBlink.bind(this));
        this.store.on('busy',                 this.updateStyle.bind(this));
        /* this.store.on('update-fg', this.updateStyle.bind(this));
         * this.store.on('update-bg', this.updateStyle.bind(this)); */

        this.element = addClass(document.createElement('div'), 'neovim-cursor');
        /* this.element.addEventListener('mouseup', (e: MouseEvent) => { });
         * this.element.addEventListener('click',   (e: MouseEvent) => { }); */

        this.moveTo(0, 0);
        this.updateSize();

    }

    moveTo (line: number, col: number): DisplayCursor {
        this.bufferedPosition = {line, col};
        this.resetBlink();
        this.redraw();
        return this;
    }

    redraw() {
        const delay = this.store.cursor_draw_delay;

        if (delay <= 0) {
            this.redrawImpl();
            return;
        }

        if (this.renderDelay !== null)
            clearTimeout(this.renderDelay);

        this.renderDelay = setTimeout(() => {
            this.redrawImpl()
        }, delay);
    }

    private startBlink() {
        this.blinkDelay = setTimeout( () => {
            this.element.classList.add('blink');
        }, 500);
    }
    private stopBlink() {
        this.element.classList.remove('blink');
        if (this.blinkDelay)
            clearTimeout(this.blinkDelay);
    }
    private resetBlink () {
        this.stopBlink();
        if (this.store.blink_cursor)
            this.startBlink();
    }

    private updatePosition() {
        const {line, col} = this.store.cursor;
        this.bufferedPosition = {line, col};

        log.debug(`Cursor: moved to [${line}, ${col}])`);

        this.resetBlink();
        this.redraw();
    }
    private updateSize() {
        const {width, height} = this.store.font_attr;
        this.element.style.width  = width  + 'px';
        this.element.style.height = height + 'px';
    }
    private updateStyle() {
        if (this.store.busy) {
            this.element.classList.add('busy');
            this.stopBlink();
        } else {
            this.element.classList.remove('busy');
            this.startBlink();
            // this.redraw();
        }
    }
    private updateFocus() {
        if (this.store.focused) {
            this.element.classList.add('focused');
            if (this.store.blink_cursor)
                this.startBlink();
        } else {
            this.element.classList.remove('focused');
            this.stopBlink();
        }
    }
    private updateMode() {
        const mode = this.store.mode;
        const classList = this.element.classList;

        classList.forEach(className => {
            if (className.indexOf('-mode') != -1) {
                classList.remove(className);
            }
        })

        classList.add(mode + '-mode');

        log.debug("updateMode:", _(mode), classList);
    }

    private redrawImpl() {
        // const {line, col} = this.bufferedPosition
        const {line, col} = this.store.cursor;
        const {width, height} = this.store.font_attr;
        const left = (col  * width);
        const top = (line * height);

        this.element.style.left = left + 'px';
        this.element.style.top  = top + 'px';

        // TODO grab character & style under cursor
        const st = this.display.getStyleAt(line, col);
        const fg = st.getPropertyValue('color');
        const bg = st.getPropertyValue('background-color');

        this.element.style.color           = bg;
        this.element.style.borderColor     = fg;
        this.element.style.backgroundColor = fg;

        const c = this.display.getText(line, col);
        this.element.textContent = c;
        log.debug("c:", c);
    }

}
