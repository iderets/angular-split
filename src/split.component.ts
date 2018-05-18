import { Component, ChangeDetectorRef, Input, Output, HostBinding, ElementRef, SimpleChanges,
    ChangeDetectionStrategy, EventEmitter, Renderer, OnDestroy, OnChanges } from '@angular/core';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import 'rxjs/add/operator/debounceTime';

import { SplitAreaDirective } from './splitArea.directive';


export interface IAreaData {
    component: SplitAreaDirective;
    autoSize: boolean;
    sizeUser: number | null;
    sizePixelUser: number | null;
    size: number;
    orderUser: number | null;
    order: number;
    minPixel: number;
    minPercent: number;
}

interface Point {
    x: number;
    y: number;
}


@Component({
    selector: 'split',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [`
        :host {
            display: flex;
            flex-wrap: nowrap;
            justify-content: flex-start;
            align-items: stretch;
            flex-direction: row;
        }

        :host.vertical {
            flex-direction: column;
        }

        split-gutter {
            flex-grow: 0;
            flex-shrink: 0;
            background-color: #eeeeee;
            background-position: center center;
            background-repeat: no-repeat;
        }

        :host.vertical split-gutter {
            width: 100%;
        }

        :host /deep/ split-area {
            transition: flex-basis 0.3s;
        }  

        :host.notransition /deep/ split-area {
            transition: none !important;
        }      

        :host /deep/ split-area.hided {
            flex-basis: 0 !important;
            overflow: hidden !important;
        }      

        :host.vertical /deep/ split-area.hided {
            max-width: 0;
        }
    `],
    template: `
        <ng-content></ng-content>
        <ng-template ngFor let-area [ngForOf]="areas" let-index="index" let-last="last">
            <split-gutter *ngIf="last === false && area.component.visible === true && !isLastVisibleArea(area)" 
                          [order]="index*2+1"
                          [direction]="direction"
                          [size]="gutterSize"
                          [disabled]="disabled"
                          (mousedown)="startDragging($event, index*2+1)"
                          (touchstart)="startDragging($event, index*2+1)"></split-gutter>
        </ng-template>`,
})
export class SplitComponent implements OnChanges, OnDestroy {
    @Input() direction: string = 'horizontal';
    @Input() width: number;
    @Input() height: number;
    @Input() gutterSize: number = 10;
    @Input() gutterInvisible: boolean = false;
    @Input() disabled: boolean = false;
    @Input() visibleTransition: boolean = false;

    @Output() dragStart = new EventEmitter<Array<number>>(false);
    @Output() dragProgress = new EventEmitter<Array<number>>(false);
    @Output() dragEnd = new EventEmitter<Array<number>>(false);
    visibleTransitionEndInternal = new Subject<Array<number>>();
    @Output() visibleTransitionEnd = this.visibleTransitionEndInternal.asObservable().debounceTime(20);

    @HostBinding('class.vertical') get styleFlexDirection() {
        return this.direction === 'vertical';
    }

    @HostBinding('style.flex-direction') get styleFlexDirectionStyle() {
        return this.direction === 'horizontal' ? 'row' : 'column';
    }

    @HostBinding('class.notransition') get dragging() {
        // prevent animation of areas when visibleTransition is false, or resizing
        return !this.visibleTransition || this.isDragging;
    }

    @HostBinding('style.width') get styleWidth() {
        return (this.width && !isNaN(this.width) && this.width > 0) ? this.width + 'px' : '100%';
    }

    @HostBinding('style.height') get styleHeight() {
        return (this.height && !isNaN(this.height) && this.height > 0) ? this.height + 'px' : '100%';
    }

    private get visibleAreas(): IAreaData[] {
        return this.areas.filter(a => a.component.visible);
    }

    private get nbGutters(): number {
        return this.visibleAreas.length - 1;
    }

    public areas: Array<IAreaData> = [];
    private minPercent: number = 5;
    private isDragging: boolean = false;
    private containerSize: number = 0;
    private areaASize: number = 0;
    private areaBSize: number = 0;
    private eventsDragFct: Array<Function> = [];

    constructor(private cdRef: ChangeDetectorRef,
        private elementRef: ElementRef,
        private renderer: Renderer) {}

    public ngOnChanges(changes: SimpleChanges) {
        if(changes['gutterSize'] || changes['disabled']) {
            this.refresh();
        }
    }

    public addArea(component: SplitAreaDirective, orderUser: number | null, autoSize: boolean, sizeUser: number | null, sizePixelUser: number | null, minPixel: number, minPercent: number) {
        this.areas.push({
            component,
            orderUser,
            order: -1,
            autoSize,
            sizeUser,
            sizePixelUser,
            size: -1,
            minPixel,
            minPercent: minPercent || this.minPercent
        });

        this.refresh();
    }

    public updateArea(component: SplitAreaDirective, orderUser: number | null, autoSize: boolean, sizeUser: number | null, sizePixelUser: number | null, minPixel: number, minPercent: number) {
        const item = this.areas.find(a => a.component === component);

        if(item) {
            item.orderUser = orderUser;
            item.autoSize = autoSize;
            item.sizeUser = sizeUser;
            item.sizePixelUser = sizePixelUser,
            item.minPixel = minPixel;
            item.minPercent = minPercent || this.minPercent;

            this.refresh();
        }
    }

    public removeArea(area: SplitAreaDirective) {
        const item = this.areas.find(a => a.component === area);

        if(item) {
            const index = this.areas.indexOf(item);
            this.areas.splice(index, 1);
            this.areas.forEach((a, i) => a.order = i * 2);

            this.refresh();
        }
    }

    public hideArea(area: SplitAreaDirective) {
        const item = this.areas.find(a => a.component === area);

        if(item) {
            this.refresh();
        }
    }

    public showArea(area: SplitAreaDirective) {
        const item = this.areas.find(a => a.component === area);

        if(item) {
            this.refresh();
        }
    }

    public isLastVisibleArea(area: IAreaData) {
        const visibleAreas = this.visibleAreas;
        return visibleAreas.length > 0 ? area === visibleAreas[visibleAreas.length - 1] : false;
    }

    private refresh() {
        this.stopDragging();

        const visibleAreas = this.visibleAreas;

        // ORDERS: Set css 'order' property depending on user input or added order
        const nbCorrectOrder = this.areas.filter(a => a.orderUser !== null && !isNaN(a.orderUser)).length;
        if(nbCorrectOrder === this.areas.length) {
            this.areas.sort((a, b) => +a.orderUser - +b.orderUser);
        }

        this.areas.forEach((a, i) => {
            a.order = i * 2;
            a.component.setStyle('order', a.order);
        });

        // PIXEL SIZES: update minPercent size if minPixel size set. And calculate persent size according to specified pixel size
        const prop = (this.direction === 'horizontal') ? 'offsetWidth' : 'offsetHeight';
        const containerSize = this.elementRef.nativeElement[prop];
        this.areas.forEach((a) => {
            a.sizeUser = a.sizePixelUser ? a.sizePixelUser/containerSize*100 : a.sizeUser;
            a.minPercent = a.minPixel ? a.minPixel/containerSize*100 : a.minPercent;
        });

        // SIZES: Set css 'flex-basis' property depending on user input or equal sizes
        const autoSizedAreasCount = visibleAreas.filter(a => a.autoSize).length;
        if (autoSizedAreasCount > 0) {
            const presetSize = visibleAreas.filter(a => !a.autoSize).map(a => a.sizeUser).reduce((acc, s) => acc + s, 0);
            visibleAreas.forEach((a) => {
                a.sizeUser = a.autoSize ? (100 - presetSize)/autoSizedAreasCount : a.sizeUser;
            });
        }

        const totalSize = visibleAreas.map(a => a.sizeUser).reduce((acc, s) => acc + s, 0);
        const nbCorrectSize = visibleAreas.filter(a => a.sizeUser !== null && !isNaN(a.sizeUser) && a.sizeUser >= a.minPercent).length;

        if(totalSize < 99.99 || totalSize > 100.01 || nbCorrectSize !== visibleAreas.length) {
            const size = Number((100 / visibleAreas.length).toFixed(3));
            visibleAreas.forEach(a => a.size = size);
        } else {
            visibleAreas.forEach(a => a.size = Number(a.sizeUser));
        }

        this.refreshStyleSizes();
        this.cdRef.markForCheck();
    }

    private refreshStyleSizes() {
        const visibleAreas = this.visibleAreas;

        if (this.gutterInvisible) {
            visibleAreas.forEach(a => {
                a.component.setStyle('flex-basis', `${a.size}%`);
            });
        } else {
            const f = this.gutterSize * this.nbGutters / visibleAreas.length;
            visibleAreas.forEach(a => {
                a.component.setStyle('flex-basis', `calc( ${a.size}% - ${f}px )`);
            });
        }
    }

    public startDragging(startEvent: MouseEvent | TouchEvent, gutterOrder: number) {
        startEvent.preventDefault();

        if(this.disabled) {
            return;
        }

        const areaA = this.areas.find(a => a.order === gutterOrder - 1);
        const areaB = this.areas.find(a => a.order === gutterOrder + 1);
        if(!areaA || !areaB) {
            return;
        }

        const prop = (this.direction === 'horizontal') ? 'offsetWidth' : 'offsetHeight';
        this.containerSize = this.elementRef.nativeElement[prop];
        this.areaASize = this.containerSize * areaA.size / 100;
        this.areaBSize = this.containerSize * areaB.size / 100;

        let start: Point;
        if(startEvent instanceof MouseEvent) {
            start = {
                x: startEvent.screenX,
                y: startEvent.screenY
            };
        }
        else if(startEvent instanceof TouchEvent) {
            start = {
                x: startEvent.touches[0].screenX,
                y: startEvent.touches[0].screenY
            };
        }
        else {
            return;
        }

        this.eventsDragFct.push( this.renderer.listenGlobal('document', 'mousemove', e => this.dragEvent(e, start, areaA, areaB)) );
        this.eventsDragFct.push( this.renderer.listenGlobal('document', 'touchmove', e => this.dragEvent(e, start, areaA, areaB)) );
        this.eventsDragFct.push( this.renderer.listenGlobal('document', 'mouseup', e => this.stopDragging()) );
        this.eventsDragFct.push( this.renderer.listenGlobal('document', 'touchend', e => this.stopDragging()) );
        this.eventsDragFct.push( this.renderer.listenGlobal('document', 'touchcancel', e => this.stopDragging()) );

        areaA.component.lockEvents();
        areaB.component.lockEvents();

        this.isDragging = true;
        this.notify('start');
    }

    private dragEvent(event: MouseEvent | TouchEvent, start: Point, areaA: IAreaData, areaB: IAreaData) {
        if(!this.isDragging) {
            return;
        }

        let end: Point;
        if(event instanceof MouseEvent) {
            end = {
                x: event.screenX,
                y: event.screenY
            };
        }
        else if(event instanceof TouchEvent) {
            end = {
                x: event.touches[0].screenX,
                y: event.touches[0].screenY
            };
        }
        else {
            return;
        }

        this.drag(start, end, areaA, areaB);
    }

    private drag(start: Point, end: Point, areaA: IAreaData, areaB: IAreaData) {
        const offsetPixel = (this.direction === 'horizontal') ? (start.x - end.x) : (start.y - end.y);

        const newSizePixelA = this.areaASize - offsetPixel;
        const newSizePixelB = this.areaBSize + offsetPixel;

        if(areaA.minPixel) {
            areaA.minPercent = areaA.minPixel / this.containerSize * 100
        }
        if(areaB.minPixel) {
            areaB.minPercent = areaB.minPixel / this.containerSize * 100
        }

        let newSizePercentA = newSizePixelA / this.containerSize * 100;
        let newSizePercentB = newSizePixelB / this.containerSize * 100;

        if(newSizePercentA <= areaA.minPercent) {
            newSizePercentA = areaA.minPercent;
            newSizePercentB = areaA.size + areaB.size - areaA.minPercent;
        } else if(newSizePercentB <= areaB.minPercent) {
            newSizePercentB = areaB.minPercent;
            newSizePercentA = areaA.size + areaB.size - areaB.minPercent;
        } else {
            newSizePercentA = Number(newSizePercentA.toFixed(3));
            newSizePercentB = Number((areaA.size + areaB.size - newSizePercentA).toFixed(3));
        }

        areaA.size = newSizePercentA;
        areaB.size = newSizePercentB;

        this.refreshStyleSizes();
        this.notify('progress');
    }

    private stopDragging() {
        if(!this.isDragging) {
            return;
        }

        this.areas.forEach(a => a.component.unlockEvents());

        while(this.eventsDragFct.length > 0) {
            const fct = this.eventsDragFct.pop();
            if(fct) {
                fct();
            }
        }

        this.containerSize = 0;
        this.areaASize = 0;
        this.areaBSize = 0;

        this.isDragging = false;
        this.notify('end');
    }

    notify(type: string) {
        const data: Array<number> = this.visibleAreas.map(a => a.size);

        switch(type) {
            case 'start':
                return this.dragStart.emit(data);

            case 'progress':
                return this.dragProgress.emit(data);

            case 'end':
                return this.dragEnd.emit(data);

            case 'visibleTransitionEnd':
                return this.visibleTransitionEndInternal.next(data);
        }
    }

    public ngOnDestroy() {
        this.stopDragging();
    }
}
