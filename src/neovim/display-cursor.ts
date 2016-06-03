import {EventEmitter} from 'events';
import NeovimStore from './store';
import TextDisplay from './display';
import log from '../log';
import {dragEnd} from './actions';

function _ (msg: any) {
    return JSON.stringify(msg);
}

type Position = {line: number, col: number}

export default class DisplayCursor {
    public element: HTMLElement;
    // ---
    private renderDelay: any;
    private blinkDelay: any;
    private _line: number;
    private _col: number;

    constructor(private store: NeovimStore,
                private display: TextDisplay) {
        this.renderDelay      = null;
        this.blinkDelay       = null;

        this.store.on('cursor',               this.updatePosition.bind(this));
        this.store.on('mode',                 this.updateMode.bind(this));
        this.store.on('input',                this.updateStyle.bind(this));
        this.store.on('focus-changed',        this.updateFocus.bind(this));
        this.store.on('font-size-changed',    this.updateSize.bind(this));
        this.store.on('blink-cursor-started', this.startBlink.bind(this));
        this.store.on('blink-cursor-stopped', this.stopBlink.bind(this));
        this.store.on('busy',                 this.updateStyle.bind(this));
        this.store.on('update-fg', this.updateStyle.bind(this));
        this.store.on('update-bg', this.updateStyle.bind(this)); 

        this.element = document.createElement('span');
        this.element.id = 'neovim-cursor';
        // this.element.classList.add('neovim-cursor');
        /* this.element.addEventListener('mouseup', (e: MouseEvent) => { });
         * this.element.addEventListener('click',   (e: MouseEvent) => { }); */

        this.moveTo(0, 0);
        this.updateSize();
    }

    moveTo (line: number, col: number): DisplayCursor {
        this.line = line;
        this.col  = col;
        this.resetBlink();
        return this;
    }

    /* Triggers a “redraw” of the cursor after cursor_draw_delay.
     */
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

        return this;
    }
    redrawImmediate () {
        this.redrawImpl();
    }

    get line() {
        return this._line;
    }
    set line(value) {
        this._line = value;
        const {height} = this.store.font_attr;
        this.element.style.top = (value * height) + 'px';
    }
    get col() {
        return this._col;
    }
    set col(value) {
        this._col = value;
        const {width} = this.store.font_attr;
        this.element.style.left = (value * width) + 'px';
    }

    private startBlink() {
        this.blinkDelay = setTimeout( () => {
            this.element.classList.add('blink');
        }, 350);
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
        this._line = line;
        this._col  = col;
        // log.debug(`Cursor: moved to [${line}, ${col}])`);
        this.resetBlink();
        this.redraw();
    }
    private updateSize() {
        const {width, height} = this.store.font_attr;
        this.element.style.width  = width  + 'px';
        this.element.style.height = height + 'px';
    }
    private updateStyle() {
        this.resetBlink();
        this.redraw();
    }
    private updateFocus() {
        this.resetBlink();
        this.redraw();
    }
    private updateMode() {
        this.resetBlink();
        this.redraw();
    }

    private redrawImpl() {
        const {
            fg_color,
            bg_color,
            focused, busy, mode,
            blink_cursor,
        } = this.store;
        const {width, height} = this.store.font_attr;
        const line = this._line,
              col  = this._col;
        const left = (col  * width);
        const top  = (line * height);
        this.element.style.left = left + 'px';
        this.element.style.top  = top + 'px';

        this.element.className = '';

        const classList = this.element.classList;
                          classList.add(mode + '-mode');
        if (busy)         classList.add('busy');
        if (focused)      classList.add('focused');
        if (blink_cursor) this.startBlink();


        const cursorChar = this.display.getCharAt(line, col);
        const styles = this.display.getStyleAt(line, col);
        const fontWeight     = styles.getPropertyValue('font-weight');
        const fontStyle      = styles.getPropertyValue('font-style');
        const textDecoration = styles.getPropertyValue('text-decoration');

        let fg = styles.getPropertyValue('color');
        let bg = styles.getPropertyValue('background-color');
        if (bg == "rgba(0, 0, 0, 0)")
            bg = bg_color; // no-bg, aka same as global bg

        this.element.style.color           = bg;
        this.element.style.borderColor     = fg;
        this.element.style.backgroundColor = fg;
        this.element.style.fontWeight      = fontWeight;
        this.element.style.fontStyle       = fontStyle;
        this.element.style.textDecoration  = textDecoration;

        this.element.textContent = cursorChar;
        log.debug("cursor:", cursorChar, fg, bg);
    }

}

