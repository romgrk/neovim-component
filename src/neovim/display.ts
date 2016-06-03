import NeovimStore from './store';
import * as A from './actions';
import Cursor from './cursor';
import DisplayCursor from './display-cursor';
import Input from './input';
import log from '../log';

// Utilities
function _ (msg: any) { return JSON.stringify(msg); }
function create (tag = 'div', ...classList: string[]) {
    const newElement = document.createElement(tag);
    newElement.classList.add(...classList); // 'neovim-editor'
    return newElement;
}
function addClass (element: HTMLElement, ...classes: string[]): HTMLElement {
    element.classList.add(...classes);
    return element;
}
function removeChildren (node: Node) {
    while (node.lastChild)
        node.removeChild(node.lastChild);
    return node;
}

export class TextRange {
    startNode: Node;
    startOffset: number;
    endNode: Node;
    endOffset: number;
    content: string;

    private _prev: Node;
    private _next: Node;

    constructor(public container: Node,
                col: number,
                endCol?: number) {

        this.startNode = null;
        this.endNode = null;
        // startOffset: number,
        // endOffset: number;
        let txt = container.textContent;

        endCol = endCol || txt.length;

        this.content = txt.substring(col, endCol);

        let node = container.firstChild;
        let charIndex = 0;
        while (node != null) {
            let len = node.textContent.length;

            if ((this.startNode == null) &&
                    (charIndex + len) >= col) {
                this.startNode = node;
                this.startOffset = col - charIndex;
            }

            if (charIndex + len >= endCol) {
                this.endNode = node;
                this.endOffset = endCol - charIndex;
                break;
            }

            charIndex += len;
            node = node.nextSibling;
        }
    }

    insert(node: DocumentFragment) {
        log.debug(this._next);
        this.container.insertBefore(node, this._next);
    }

    extract() {
        const r = document.createDocumentFragment();

        let aNode = this.startNode;
        let bNode = this.endNode;
        let oa = this.startOffset;
        let ob = this.endOffset;

        if (oa != 0) {
            aNode = aNode.cloneNode(true);
            aNode.textContent = aNode.textContent.slice(0, oa);
            this.container.insertBefore(aNode, this.startNode);
        }

        if (bNode && ob != bNode.textContent.length) {
            bNode = bNode.cloneNode(true);
            bNode.textContent = bNode.textContent.slice(ob);
            this.container.insertBefore(bNode, this.endNode.nextSibling);

            this.endNode.textContent =
                this.endNode.textContent.slice(0, ob);
        }

        this.startNode.textContent =
            this.startNode.textContent.slice(oa);


        const nodes: Node[] = [];
        let node = this.startNode;
        while (node) {
            nodes.push(node);
            this._next = node.nextSibling;
            if (node === this.endNode) break;
            node = node.nextSibling;
        }
        nodes.forEach(n => {
            this.container.removeChild(n);
            r.appendChild(n);
        });

        return r;
    }
}

export default class TextDisplay {
    container: HTMLElement;
    pointer: HTMLElement;
    cursor: DisplayCursor;
    input: Input;

    constructor(private store: NeovimStore,
                public element: HTMLElement) {

        this.container = create('div', 'container');
        element.appendChild(this.container);
        this.cursor = new DisplayCursor(store, this);
        element.appendChild(this.cursor.element);
        this.input = new Input(this.store);
        element.appendChild(this.input.element);

        store.on('put',       this.insertText.bind(this)     );
        store.on('clear-eol', () => this.clearTilEndOfLine() );
        store.on('clear-all', () => this.clearDisplay()      );
        store.on('update-fg', () => this.updateStyle()       );
        store.on('update-sp', () => this.updateStyle()       );
        store.on('update-bg', () => {
            this.updateStyle(); // Note: 'update-bg' clears all texts in screen.
            this.clearDisplay(); });
        store.on('screen-scrolled', this.scroll.bind(this));
        store.on('line-height-changed', () => this.changeFontSize(store.font_attr.specified_px));
        //this.store.on('scroll-region-updated', this.updateRegionOverlay.bind(this));
        store.on('busy', () => {
            if (store.busy)
                element.classList.add('busy');
            else
                element.classList.remove('busy'); });

        element.addEventListener('click',     this.focus.bind(this));
        element.addEventListener('wheel',     this.onWheel.bind(this));
        element.addEventListener('mousedown', this.onMouseDown.bind(this));
        element.addEventListener('mouseup',   this.onMouseUp.bind(this));
        element.addEventListener('mousemove', this.onMouseMove.bind(this));

        this.input.element.addEventListener(
            'keydown', this.onKeydown.bind(this));

        this.updateStyle();
        this.checkShouldResize();
        // this.changeFontSize(this.store.font_attr.specified_px);
    }

    onWheel(e: WheelEvent) {
        this.element.classList.remove('no-mouse');
        const pos = this.getPositionFrom(e);
        this.store.dispatcher.dispatch(A.wheelScroll(e));
    }
    onMouseDown(e: MouseEvent) {
        this.element.classList.remove('no-mouse');
        const pos = this.getPositionFrom(e);
        this.store.dispatcher.dispatch(A.dragStart(e));
    }
    onMouseUp(e: MouseEvent) {
        this.element.classList.remove('no-mouse');
        const pos = this.getPositionFrom(e);
        this.store.dispatcher.dispatch(A.dragEnd(e));
    }
    onMouseMove(event: MouseEvent) {
        this.element.classList.remove('no-mouse');
        const pos = this.getPositionFrom(event);
        if (event.buttons !== 0)
            this.store.dispatcher.dispatch(A.dragUpdate(event));
    }
    onKeydown (event: Event) {
        this.element.classList.add('no-mouse');
    }

    get lines() {
        return this.container.children; }
    get pos() {
        const {line, col} = this.store.cursor;
        return {line, col};
    }

    getLine(n: number): Node {
        const line = this.container.children.item(n);

        if (line && line.childElementCount == 0)
            line.appendChild(create('span'));

        return line;
    }

    focus() {
        this.input.focus();
    }
    getCharAt(line: number, col: number): string {
        const lineNode = this.container.children.item(line);
        if (lineNode === null) return '';
        return lineNode.textContent.charAt(col);
    }
    getStyleAt(line: number, col: number) {
        const lineNode = this.container.children.item(line);

        if (lineNode === null || lineNode.textContent.length <= col)
            return window.getComputedStyle(this.element);

        let charIndex = 0;
        let node = lineNode.firstChild;

        while (node != null) {
            charIndex += node.textContent.length;

            if (charIndex > col) break;

            node = node.nextSibling;
        }

        return window.getComputedStyle(node as HTMLElement);
    }
    convertPositionToLocation (line: number, col: number) {
        const {width, height} = this.store.font_attr;
        const bounds = this.container.getBoundingClientRect();

        const x = col  * width;
        const y = line * height;

        const clientX = x + bounds.left;
        const clientY = y + bounds.top;

        return {
            x, y,
            clientX, clientY
        };
    }
    convertLocationToPosition (x: number, y: number) {
        return {
            line: Math.floor(y / this.store.font_attr.height),
            col:  Math.floor(x / this.store.font_attr.width),
        };
    }
    getPositionFrom (event: MouseEvent) {
        const bounds = this.container.getBoundingClientRect();
        const {clientX, clientY} = event;

        let x = clientX - bounds.left;
        let y = clientY - bounds.top;

        const pos = this.convertLocationToPosition(x, y);

        let e = event as any;
        e.line = pos.line;
        e.col  = pos.col;

        return pos;
    }

    changeFontSize(size_px: number) {
        this.element.style.fontSize = size_px + 'px';

        const rect     = TextDisplay.getFontSize(this.element);
        const heightPx = this.store.line_height * size_px;
        const widthPx  = rect.width;

        this.store.dispatcher.dispatch(A.updateFontPx(size_px));
        this.store.dispatcher.dispatch(
            A.updateFontSize(
                widthPx, heightPx,
                widthPx, heightPx
            )
        );
    }

    checkShouldResize() {
        // const p = this.element.parentElement;
        const p = this.element;
        // const {size} = this.store;
        const cw = p.offsetWidth;
        const ch = p.offsetHeight;

        const lines = Math.floor(ch / this.store.font_attr.height);
        const cols  = Math.floor(cw / this.store.font_attr.width);

        this.resizeImpl(lines, cols, cw, ch);
    }
    resize (lines: number, cols: number) {
        const heightPx = lines * this.store.font_attr.height;
        const widthPx  = cols  * this.store.font_attr.width;
        this.resizeImpl(lines, cols, widthPx, heightPx);
    }
    resizeWithPixels (width: number, height: number) {
        const lines = Math.floor(height / this.store.font_attr.height);
        const cols  = Math.floor(width  / this.store.font_attr.width);
        this.resizeImpl(lines, cols, width, height);
    }

    /* FIXME
     * UI handling should be asynchronous. Just log the neovim
     * events, and redraw appropriately later.
     */

    scroll(delta: number) {
        /*  delta > 0 => screen goes up
         *  delta < 0 => screen goes down */
        const {top, bottom, left, right} = this.store.scroll_region;
        const charWidth = (right + 1) - left;
        const fillSpace = " ".repeat(charWidth);

        this.input.setIgnoreFocus(true);

        log.debug('Scroll: ', _(this.store.scroll_region));

        // const ranges    = this.getScrollRegionRanges();
        const ranges: TextRange[] = [];
        for (let n = top; n <= bottom; n++) {
            const lineNode = this.getLine(n);
            const r = new TextRange(lineNode, left, right + 1);

            if (r.content.length < charWidth) {
                log.warn(`r.content.length(${r.content.length}) < charWidth(${charWidth})`);
            }

            ranges.push(r);
        }

        const fragments = ranges.map(r => r.extract());

        for (let i = 0; i < Math.abs(delta); i++) {
            let frag = this.newSpan(fillSpace, null);
            // let frag = document.createDocumentFragment();
            if (delta > 0) {
                fragments.shift();
                fragments.push(frag);
            } else {
                fragments.pop();
                fragments.unshift(frag);
            }
        }

        for (let i = 0; i < ranges.length; i++) {
            let range = ranges[i];
            let fragment = fragments[i];
            range.insert(fragment);
            this.clearEmptyNodes(range.container);
        }

        this.input.setIgnoreFocus(false);
    }
    insertText(chars: string[][]) {
        const {line, col} = this.store.cursor;
        const currentLine = this.getLine(line);
        const endCol = col + chars.length;

        const text = chars.map(c => c[0]).join(""); // XXX unright.
        /* if (text.length != chars.length)
         * log.warn('text.length != chars.length',
         *         text.length, chars.length); */

        log.debug(`Put: [${line}][${col} - ${endCol}]`, _(text));

        const widthDiff = col - currentLine.textContent.length;
        if (widthDiff > 0) {
            const spaces = " ".repeat(widthDiff);
            const lastNode = currentLine.lastChild;
            const newNode = this.newSpan(text);
            lastNode.textContent += spaces;
            currentLine.appendChild(newNode);
            return;
        }

        const n = new TextRange(currentLine, col, endCol);

        let aNode = n.startNode;
        let bNode = n.endNode;
        let aOffset = n.startOffset;
        let bOffset = n.endOffset;

        if (aNode == bNode) {
            aNode = aNode.cloneNode(true);
            currentLine.insertBefore(aNode, bNode);
        }
        if (aNode != null)
            aNode.textContent = aNode.textContent.slice(0, aOffset);
        if (bNode != null)
            bNode.textContent = bNode.textContent.slice(bOffset);

        while (aNode != null &&
               aNode.nextSibling &&
               aNode.nextSibling != bNode)
            currentLine.removeChild(aNode.nextSibling);

        const newNode = this.newSpan(text);
        currentLine.insertBefore(newNode, bNode);
        this.clearEmptyNodes(currentLine);

        // log.debug(_(currentLine.textContent), currentLine.textContent.length);
        if ((this.store.size.cols - currentLine.textContent.length) < 0)
            log.warn(_([col, endCol]),
                     _(currentLine.textContent),
                     currentLine.textContent.length);
    }

    updateStyle () {
        const {
            fg_color,
            bg_color,
            line_height,
            font_attr} = this.store;
        const {
            width, height,
            specified_px,
            face} = font_attr;

        this.element.style.color           = fg_color;
        this.element.style.backgroundColor = bg_color;
        this.element.style.fontFamily      = face;
        this.element.style.fontSize        = specified_px + 'px';
        this.element.style.lineHeight      = (line_height * specified_px ) + 'px';
        this.container.style.minHeight     = (line_height * specified_px ) + 'px';
        this.container.style.minHeight     = (line_height * specified_px ) + 'px';
    }

    private clearDisplay() {
        let lineNode = this.container.firstChild;
        while (lineNode != null) {
            while (lineNode.firstChild)
                lineNode.removeChild(lineNode.firstChild);
            lineNode.appendChild(this.newSpan(null, null));
            lineNode = lineNode.nextSibling;
        }
    }
    private clearTilEndOfLine () {
        const {line, col} = this.store.cursor;
        const lineNode = this.getLine(line);
        log.debug('clearTilEndOfLine:', _(this.pos));

        let charIndex = 0;
        let node = lineNode.firstChild;

        while (node != null) {
            let len = node.textContent.length;

            if (charIndex + len < col) {
                charIndex += len;
                node = node.nextSibling;
                continue;
            }

            if (charIndex + len > col)
                node.textContent = node.textContent.substring(0, col - charIndex);

            while (node.nextSibling)
                lineNode.removeChild(node.nextSibling);

            break;
        }

        if (lineNode.textContent.length < this.store.size.cols) {
            let width = this.store.size.cols - lineNode.textContent.length;
            log.debug('\t: (missing):', width);
            // lineNode.appendChild(this.newSpan(" ".repeat(width), null));
        }
    }
    private clearEmptyNodes(line: Node): void {
        const nodes = line.childNodes;
        for (let i = 0; i < nodes.length; i++) {
            let node = nodes.item(i);
            if (node.textContent.length == 0) {
                log.debug('clearingEmptyNode:', _(this.pos));
                line.removeChild(node);
            }
        }
    }

    private getScrollRegionRanges() {
        const {top, bottom, left, right} = this.store.scroll_region;

        const ranges: TextRange[] = [];

        log.debug('getScrollRegionRanges():', this.store.scroll_region);
        for (let n = top; n <= bottom; n++) {
            const lineNode = this.getLine(n);
            const r = new TextRange(lineNode, left, right);
            ranges.push(r);
        }

        return ranges;
    }
    private getNodeAt(line: number, col: number, endCol?: number): TextRange {
        const lineNode = this.getLine(line);
        if (lineNode == null) return null;
        return new TextRange(lineNode, col, endCol);
    }
    private newSpan(text = "", font_attr = this.store.font_attr): HTMLElement {
        if (text == null)
            text = " ".repeat(this.store.size.cols);

        const span = create('span');
        span.textContent = text;

        if (font_attr == null)
            return addClass(span, 'spacing');

        const {
            fg, bg, sp,
            bold, italic,
            underline, undercurl
        } = font_attr;

        if (fg != this.store.fg_color)
            span.style.color = fg;

        if (bg != this.store.bg_color)
            span.style.backgroundColor = bg;

        if (sp.length > 0 && sp.charAt(0) === '.')
            span.classList.add(sp.substring(1));
        else
            span.setAttribute('guisp', String(sp));

        if (bold)      span.style.fontWeight = 'bold';
        if (italic)    span.style.fontStyle  = 'italic';
        if (underline) span.style.textDecoration = 'underline';
        if (undercurl) span.classList.add('undercurl');

        return span;
    }

    private resizeImpl (lines: number, cols: number, width: number, height: number) {
        lines = Math.max(10, lines);

        const children = this.container.children;

        while (children.length < lines) {
            const lineNode = create('div');
            this.container.appendChild(lineNode);
            //lineNode.appendChild(spanNode);
        }

        while (children.length > lines) {
            if (!this.container.lastChild) break;
            this.container.removeChild(this.container.lastChild);
        }

        log.debug(`resizeImpl(): lines: ${lines}  children.length: ${children.length}`);

        this.store.dispatcher.dispatch(A.updateScreenSize(width, height));
        this.store.dispatcher.dispatch(A.updateScreenBounds(lines, cols));
    }

    /*
     * Section: static
     */

    static getFontSize(e: HTMLElement): ClientRect {
        const o = document.createElement('span');
        o.style.font = e.style.font;
        o.style.position = 'absolute';
        o.style.whiteSpace = 'nowrap';
        o.style.visibility = 'hidden';
        o.innerText = 'o';
        e.appendChild(o);
        let r = o.getBoundingClientRect();
        o.remove()
        return r;
    }

}
