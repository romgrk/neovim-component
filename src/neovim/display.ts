import NeovimStore from './store';
import * as A from './actions';
import Cursor from './cursor';
import Input from './input';
import log from '../log';

interface Position {
    line: number;
    col: number;
    character?: number;
}

interface TextRange {
    node: Node;
    offset: number;
    start: number;
    end: number;
    length: number;
}

// Utilities @f

function _ (msg: any): string {
    return JSON.stringify(msg);
}
function splitNodeAt (node: Node, start: number, end: number) {
    const newNode = node.cloneNode();
    newNode.textContent = node.textContent.slice(0, start);
    node.textContent = node.textContent.slice(end);
    node.parentElement.insertBefore(newNode, node);
    log.debug('splitNode:',
              _([0, start]), _(newNode.textContent),
              _([end]), _(node.textContent));
}
function splitNode(node: Text, offset: number): Node {
    const parent = node.parentNode;

    const newParent = parent.cloneNode();
    const newText   = node.splitText(offset);

    parent.removeChild(newText);
    newParent.appendChild(newText);

    parent.parentNode.insertBefore(newParent, parent.nextSibling);

    log.debug('splitNode()', offset,
              _(node.textContent), _(newText.textContent));
    return newParent;
}
function getFontSize(e: HTMLElement): ClientRect {
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

function create (tag = 'div', ...classList: string[]) {
    const newElement = document.createElement(tag);
    newElement.classList.add('neovim-editor', ...classList);
    return newElement;
}

export default class TextDisplay {
    // store: NeovimStore,
    // element: HTMLElement;
    container: HTMLElement;
    pointer: HTMLElement;
    cursor: HTMLElement;
    //grid: HTMLElement;
    input: Input;
    widthPx: number;
    heightPx: number;

    cursorBlink: any;

    constructor(private store: NeovimStore,
                public element: HTMLElement) {

        this.container = create('div', 'container');
        element.appendChild(this.container);

        this.cursor = create('div', 'neovim-cursor');
        element.appendChild(this.cursor);

        this.pointer = create('div', 'overlay');
        this.pointer.style.border = '1px solid rgb(100,50,255)';
        document.body.appendChild(this.pointer);

        // FIXME !
        this.store.on('cursor',        this.updateCursor.bind(this));
        this.store.on('mode',          this.updateMode.bind(this));
        this.store.on('input',         this.resetBlink.bind(this));
        this.store.on('focus-changed', this.updateCursor.bind(this));

        this.store.on('put',       this.insertText.bind(this)     );
        this.store.on('clear-eol', () => this.clearTilEndOfLine() );
        this.store.on('clear-all', () => this.clearDisplay()      );
        this.store.on('update-fg', () => this.updateStyle()       );
        this.store.on('update-sp', () => this.updateStyle()       );
        this.store.on('update-bg', () => {
            this.clearDisplay(); // Note: 'update-bg' clears all texts in screen.
            this.updateStyle();
        });
        this.store.on('line-height-changed', () => this.changeFontSize(this.store.font_attr.specified_px));
        this.store.on('screen-scrolled', this.scroll.bind(this));
        //this.store.on('scroll-region-updated', this.updateRegionOverlay.bind(this));

        element.addEventListener('click',     this.focus.bind(this));
        element.addEventListener('wheel',     this.onWheel.bind(this));
        element.addEventListener('mousedown', this.onMouseDown.bind(this));
        element.addEventListener('mouseup',   this.onMouseUp.bind(this));
        element.addEventListener('mousemove', this.onMouseMove.bind(this));

        //this.cursor = new Cursor(this.store, this.ctx);
        this.input  = new Input(this.store);

        this.updateStyle();
        this.changeFontSize(this.store.font_attr.specified_px);
    }

    focus() {
        this.input.focus();
    }

    onWheel(e: WheelEvent) {
        const pos = this.getPositionFrom(e);
        this.store.dispatcher.dispatch(A.wheelScroll(e));
    }
    onMouseDown(e: MouseEvent) {
        const pos = this.getPositionFrom(e);
        this.store.dispatcher.dispatch(A.dragStart(e));
    }
    onMouseUp(e: MouseEvent) {
        const pos = this.getPositionFrom(e);
        this.store.dispatcher.dispatch(A.dragEnd(e));
    }
    onMouseMove(event: MouseEvent) {
        const pos = this.getPositionFrom(event);

        if (event.buttons !== 0)
            this.store.dispatcher.dispatch(A.dragUpdate(event));

        //const {width, height} = this.store.font_attr;
        const c = this.convertPositionToLocation(pos.line, pos.col);
        //log.debug('event:', event);
        //log.debug('pos:', pos);
        //log.debug('coords:', c);
        //this.pointer.style.top  = c.clientY + 'px';
        //this.pointer.style.left = c.clientX + 'px';
    }

    get lines(): HTMLCollection {
        return this.container.children;
    }
    get pos(): Position {
        const {line, col} = this.store.cursor;
        return {line, col};
    }
    get origin()  {
        let r = this.container.getBoundingClientRect();
        let coords = [r.left, r.top] as any;
        coords.x = r.left;
        coords.y = r.top;
        return coords;
    }
    getLine(n: number): Node {
        if (n >= this.container.children.length)
            this.adjustLines();

        const line = this.container.children.item(n);

        if (line.childElementCount == 0)
            line.appendChild(this.newSpan(null, null));

        return line;
    }

    getText(line: number, col?: number): string {
        let text = this.getLine(line).textContent;

        if (col)
            text = text.charAt(col);

        return text;
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

    clearDisplay() {
        let lineNode = this.container.firstChild;
        while (lineNode != null) {
            while (lineNode.firstChild)
                lineNode.removeChild(lineNode.firstChild);
            lineNode.appendChild(this.newSpan(null, null));
            lineNode = lineNode.nextSibling;
        }
    }
    clearTilEndOfLine () {
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
            lineNode.appendChild(this.newSpan(" ".repeat(width), null));
        }
    }
    clearEmptyNodes(line: Node): void {
        const nodes = line.childNodes;
        for (let i = 0; i < nodes.length; i++) {
            let node = nodes.item(i);
            if (node.textContent.length == 0) {
                log.debug('clearingEmptyNode:', _(this.pos));
                line.removeChild(node);
            }
        }
    }

    insertText(chars: string[][]) {
        /*
        *           col=start            end                  size.cols
        *  [-------------|----------------|-----------------------]
        *                |<-- col_span -->|
        */
        // XXX unright. Some characters may be empty
        let text  = chars.map(c => c[0]).join("");

        const start = this.store.cursor.col;
        const end   = start + text.length;
        const {line, col} = this.store.cursor;

        log.debug(`insertText(): [${line}, ${col}] - [${line}, ${end}]`, _(text));

        const currentLine = this.getLine(line) as Element;
        //const range = this.getRange(currentLine, start, end);
        const ra = this.getNodeAt(currentLine, start);
        const rb = this.getNodeAt(currentLine, end);
        const aNode = ra.node;
        const bNode = rb.node;

        let nextNode: Node = null;

        if (aNode == null && bNode == null) {
            const spaces = " ".repeat(start - currentLine.textContent.length);
            const fillNode = this.newSpan(spaces, null)
            currentLine.appendChild(fillNode);

        } else if (bNode == aNode) {
            log.debug('\t: aNode == bNode;', ra, rb);
            splitNodeAt(aNode, ra.offset, rb.offset);
            nextNode = aNode;

        } else if (aNode != bNode && bNode != null) {
            log.debug('\t: aNode != bNode;',
                    _(aNode.textContent),
                    _(bNode.textContent));

            aNode.textContent = aNode.textContent.slice(0, ra.offset);
            bNode.textContent = bNode.textContent.slice(rb.offset);

            while (aNode.nextSibling && aNode.nextSibling != bNode) {
                currentLine.removeChild(aNode.nextSibling);
            }

            nextNode = bNode;

        } else {
            log.debug('\t: aNode != bNode && bNode == null;',
                    _(this.pos), _(aNode.textContent));

            aNode.textContent = aNode.textContent.slice(0, ra.offset);

            while (aNode.nextSibling) {
                currentLine.removeChild(aNode.nextSibling);
            }
        }

        const newNode = this.newSpan(text);
        currentLine.insertBefore(newNode, nextNode);

        log.debug('\t: INSERT', _(text), _(this.pos),
                  '\t: LINE', _(currentLine.textContent), currentLine.textContent.length);

        this.clearEmptyNodes(currentLine);

        let widthDiff = this.store.size.cols - currentLine.textContent.length;
        if (widthDiff > 0) {
            log.debug('\t: (missing):', widthDiff);
            currentLine.appendChild(this.newSpan(" ".repeat(widthDiff), null));
        }
    }

    changeFontSize(size_px: number) {
        this.container.style.fontSize = size_px + 'px';

        const heightPx = this.store.line_height * size_px;
        const rect     = getFontSize(this.container);
        const widthPx  = rect.width;

        this.widthPx  = widthPx;
        this.heightPx = heightPx;

        this.store.dispatcher.dispatch(A.updateFontPx(size_px));
        this.store.dispatcher.dispatch(
            A.updateFontSize(
                widthPx, heightPx,
                widthPx, heightPx
            )
        );

        //const bounds = this.element.getBoundingClientRect();
        //this.resizeWithPixels(bounds.width, bounds.height);
        const p = this.element.parentElement;
        const cw = p.offsetWidth;
        const ch = p.offsetHeight;
        this.resizeWithPixels(cw, ch);
    }
    changeLineHeight(new_value: number) {
        this.store.dispatcher.dispatch(A.updateLineHeight(new_value));
    }
    checkShouldResize() {
        const p = this.element.parentElement;
        const cw = p.offsetWidth;
        const ch = p.offsetHeight;
        this.resizeWithPixels(cw, ch);
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

    getRange(container: Node, start: number, end: number) {
        const stop = {};
        const range = document.createRange();
        range.selectNodeContents(container);

        let charIndex  = 0,
            foundStart = false,
            foundEnd   = false,
            lastText: Node;

        const self = this;
        function traverseTextNodes(node: Node) {
            if (node.nodeType == 3) {
                lastText = node;
                let len = node.textContent.length;

                if (!foundStart && ((charIndex + len) > start)) {
                    let offset = start - charIndex;
                    let startNode = node;

                    if (offset != 0)
                        startNode = splitNode(<Text>node, offset);

                    range.setStartBefore(startNode.parentNode);
                    foundStart = true;
                    //log.debug('getRange(): START:', {start, end, charIndex, offset})
                }

                if (foundStart && ((charIndex + len) > end)) {
                    const offset = end - charIndex + 1;

                    let endNode = node;
                    let afterNode: Node;

                    if (offset != len)
                         afterNode = splitNode(<Text>node, offset);

                    range.setEndAfter(endNode.parentNode);

                    //log.debug('getRange(): END:', {end, charIndex, offset})
                    throw stop;
                }

                charIndex += len;
            } else {
                for (let i = 0, len = node.childNodes.length; i < len; ++i) {
                    traverseTextNodes(node.childNodes[i]);
                }
            }
        }

        try {
            traverseTextNodes(container);
        } catch (ex) {
            if (ex != stop)
                throw ex;
            return range;
        }

        range.setEndAfter(lastText);
        return range;
    }
    getScrollRegionRanges(): Range[] {
        const {top, bottom,
               left, right} = this.store.scroll_region;

        const ranges: Range[] = [];

        log.debug('getScrollRegionRanges():', this.store.scroll_region);
        for (let n = top; n <= bottom; n++) {
            let r = this.getRange(this.getLine(n), left, right);
            log.debug(`r: [${n}, ${left}] - [${n}, ${right}]:`,
                      _(r.toString()));
            ranges.push(r);
        }

        return ranges;
    }

    /*  delta > 0 => screen goes up
     *  delta < 0 => screen goes down
     */
    scroll(delta: number) {
        const {top, bottom,
               left, right} = this.store.scroll_region;
        const charWidth = right - left + 1;

        const ranges = this.getScrollRegionRanges();
        const fragments = ranges.map(r => r.extractContents());

        log.debug(': SCROLL', _(this.store.scroll_region));

        for (let i = 0; i < Math.abs(delta); i++) {
            //let frag = document.createDocumentFragment();
            //frag.appendChild(this.newSpan(" ".repeat(charWidth), null));
            let frag = this.newSpan(" ".repeat(charWidth), null);

            if (delta > 0) {
                log.debug(fragments.shift());
                fragments.push(frag);
            } else {
                log.debug(fragments.pop());
                fragments.unshift(frag);
            }
        }

        for (let i = 0; i < ranges.length; i++) {
            let range = ranges[i];
            range.insertNode(fragments[i]);
            this.clearEmptyNodes(range.commonAncestorContainer);
        }
    }

    updateStyle () {
        const {
            fg_color,
            bg_color,
            font_attr} = this.store;

        const height = font_attr.height;
        const width  = font_attr.width;

        const sx = font_attr.specified_px;
        const h = this.store.line_height * sx;

        this.container.style.color           = fg_color;
        this.container.style.backgroundColor = bg_color;

        this.container.style.fontFamily    = font_attr.face;
        this.container.style.fontSize      = sx + 'px';
        this.container.style.lineHeight    = h + 'px';
        this.container.style.minHeight     = h + 'px';

        this.cursor.style.width   = width  + 'px';
        this.cursor.style.height  = height + 'px';

        //this.pointer.style.width  = width  + 'px';
        //this.pointer.style.height = height + 'px';
        //this.grid.style.backgroundSize = `${widthPx}px, ${heightPx}px ${heightPx}px`;
    }
    updateMode() {
        const mode = this.store.mode;
        for (let i = 0; i < this.cursor.classList.length; i++) {
            let className = this.cursor.classList.item(i);
            if (className.indexOf('-mode') != -1) {
                this.cursor.classList.remove(className);
            }
        }
        this.cursor.classList.add(mode + '-mode');
        log.debug("updateMode:", _(mode), this.cursor.classList);
    }
    updateCursor() {
        const {line, col} = this.store.cursor;
        this.cursor.style.top  = (line * this.heightPx) + 'px';
        this.cursor.style.left = (col *  this.store.font_attr.width)  + 'px';

        if (this.store.focused) {
            this.cursor.classList.add('focused');
            this.resetBlink();
        } else {
            this.cursor.classList.remove('focused');
            this.stopBlink();
        }
    }

    private stopBlink() {
        this.cursor.classList.remove('blink');
        if (this.cursorBlink)
            clearTimeout(this.cursorBlink);
    }
    private resetBlink () {
        this.stopBlink();
        this.cursorBlink = setTimeout( () => {
            this.cursor.classList.add('blink');
        }, 500);
    }

    private adjustLines () {
        const lines = this.store.size.lines;
        const children = this.container.children;

        while (children.length < lines) {
            let lineNode = document.createElement('div');
            lineNode.classList.add('line', 'neovim-editor');
            lineNode.appendChild(this.newSpan(null, null));
            this.container.appendChild(lineNode);

            //fillLine(lineNode, cols);
            log.debug('adjustLines(): added lineNode',
                      lineNode.textContent.length,
                      children.length);
        }

        while (children.length > lines) {
            if (!this.container.lastChild)
                break;
            this.container.removeChild(this.container.lastChild);
        }

        log.debug('adjustLines(): final children.length:', children.length);
        console.assert(children.length === lines);
    }

    private getNodeAt(lineNode: Node, col: number): TextRange {
        const line = lineNode as HTMLDivElement;

        let charIndex = 0;
        let node = line.firstChild;
        while (node != null) {
            let len = node.textContent.length;

            if (charIndex + len >= col)
                break;

            charIndex += len;
            node = node.nextSibling;
        }

        let len = (node == null) ? 0 : node.textContent.length;

        return {
            node: node,
            offset: col - charIndex,
            start: col,
            end: col + len,
            length: len
        };
    }

    private getCharNodeAt (line: Node, col: number): Node {
        return this.getRange(<Element>line, col, col + 1).startContainer;
    }

    private newSpan(text = "", font_attr = this.store.font_attr): HTMLElement {

        if (text == null)
            text = " ".repeat(this.store.size.cols);

        const span = create('span', 'chars');
        span.textContent = text;

        if (font_attr == null)
            return span;

        const {
            fg, bg, sp,
            bold, italic,
            underline, undercurl
        } = font_attr;

        if (fg != this.store.fg_color)
            span.style.color = fg;

        if (bg != this.store.bg_color)
            span.style.backgroundColor = bg;

        if (bold)      span.style.fontWeight = 'bold';
        if (italic)    span.style.fontStyle  = 'italic';
        if (underline) span.style.textDecoration = 'underline';
        if (undercurl) span.style.textDecoration = 'undercurl';

        return span;
    }

    private resizeImpl (lines: number, cols: number, width: number, height: number) {
        this.store.dispatcher.dispatch(A.updateScreenSize(width, height));
        this.store.dispatcher.dispatch(A.updateScreenBounds(lines, cols));
        this.adjustLines();
    }
}
