package com.kitschpatrol
{
	import com.hurlant.math.BigInteger;
	
	import flash.display.Shape;
	import flash.display.Sprite;
	import flash.events.Event;
	import flash.events.MouseEvent;
	import flash.geom.Point;
	
	public class Window extends Sprite {
		
		// Events
		static public var SELECTION_CHANGE:String = "selection change"; // fires when the "center" cell changes
		
		// set some constants
		public const X_RES:int = 48; // pixel width
		public const Y_RES:int = 48; // pixel height
		public const BIT_DEPTH:int = 2;
		public const PANE_X_COUNT:int = 8; // set this to determine pane size, cells per pane
		public const PANE_Y_COUNT:int = 8;
		public const PADDING:int = 5; // pixels between cells		
		
		// derrived constants, don't touch
		public const X_MAX:BigInteger = BigInteger.nbv(BIT_DEPTH).pow(X_RES * (Y_RES / 2)).subtract(BigInteger.nbv(1));
		public const Y_MAX:BigInteger = X_MAX.clone(); 		
		public const CELL_WIDTH:int = X_RES + PADDING; // each picture, with padding
		public const CELL_HEIGHT:int = Y_RES + PADDING; // each picture, with padding
		public const PANE_WIDTH:int = CELL_WIDTH * PANE_X_COUNT; // a pane of cells
		public const PANE_HEIGHT:int = CELL_HEIGHT * PANE_Y_COUNT; // a pane of cells
		public const X_PIXEL_COUNT:int = X_RES * Y_RES / 2;
		public const Y_PIXEL_COUNT:int = X_PIXEL_COUNT;
		public const X_PIXEL_BYTES:int = X_PIXEL_COUNT / 8;
		public const Y_PIXEL_BYTES:int = Y_PIXEL_COUNT / 8;	
		public const X_BYTE_COUNT:int = X_RES * (Y_RES / 2) * 4; // how many bytes in half the cell
		public const Y_BYTE_COUNT:int = X_BYTE_COUNT; // how many bytes in half the cell
		public const X_BYTE_END:int = X_RES * (Y_RES / 2) * 4; // end of bytes for the pane
		public const Y_BYTE_END:int = X_RES * Y_RES * 4;
		public const PIXEL_BYTE_COUNT:int = X_RES * Y_RES * 4;			
		
		// multiply pane_width to draw more outside view
		private var xOverdraw:int = PANE_WIDTH * 2; // how much to draw outside the window
		private var yOverdraw:int = PANE_HEIGHT * 2; // how much to draw outside the window
		
		// variables
		public var xStart:BigInteger;
		public var yStart:BigInteger;
		public var xDelta:BigInteger;
		public var yDelta:BigInteger;
		public var selectedX:BigInteger;
		public var selectedY:BigInteger;
		private var xOffset:int = 0; // mouse offset
		private var yOffset:int = 0; // mouse offset
		private var lastMouseX:int;
		private var lastMouseY:int;

		private var maxWidth:int; // max window width
		private var maxHeight:int; // max window height		
		
		private var panes:Vector.<Pane> = new Vector.<Pane>(); // list of panes		
		private var renderQueue:Vector.<Pane> = new Vector.<Pane>();		
		
		// scratch
		public var xTemp:BigInteger;
		public var yTemp:BigInteger;				
		private var tempPane:Pane; // a pane to munge
		
		private var xAccumulator:int = 0; // track cell sized movements to fire change event
		private var yAccumulator:int = 0;
		
		private var windowMask:Shape = new Shape();;
		
		
		// temp
		private var overlay:Shape = new Shape();
		
		public function Window(_x:int, _y:int, _width:int, _height:int) {
			super();
			this.x = _x;
			this.y = _y;
			
			maxWidth = _width;
			maxHeight = _height;

			// fill the background
			this.graphics.beginFill(0x4a525a);
			this.graphics.drawRect(0, 0, _width, _height);
			this.graphics.endFill();
			
			// simulation settings
			xStart = BigInteger.nbv(0);
			yStart = BigInteger.nbv(0);
			xDelta = BigInteger.nbv(1);
			yDelta = BigInteger.nbv(1);
			
			// this is 5 steps to white
//			xDelta = new BigInteger("12234465498569413894406478743841145361827162748688159810039079514183939559218391664357372787631594358463168901374701809308891801671007230130066723378042125137212894594296124410621956639403190879922410562428365584417623555614966739717809626431260004568979968393974952774324960520703130399622609141713985447492509246633766908652935623681883409429299", 10);
//			yDelta = new BigInteger("12234465498569413894406478743841145361827162748688159810039079514183939559218391664357372787631594358463168901374701809308891801671007230130066723378042125137212894594296124410621956639403190879922410562428365584417623555614966739717809626431260004568979968393974952774324960520703130399622609141713985447492509246633766908652935623681883409429299", 10);
			
			// this is 5000 steps to white
//			xDelta = new BigInteger("12234465498569413894406478743841145361827162748688159810039079514183939559218391664357372787631594358463168901374701809308891801671007230130066723378042125137212894594296124410621956639403190879922410562428365584417623555614966739717809626431260004568979968393974952774324960520703130399622609141713985447492509246633766908652935623681883409429299", 10).divide(BigInteger.nbv(1000));
//			yDelta = new BigInteger("12234465498569413894406478743841145361827162748688159810039079514183939559218391664357372787631594358463168901374701809308891801671007230130066723378042125137212894594296124410621956639403190879922410562428365584417623555614966739717809626431260004568979968393974952774324960520703130399622609141713985447492509246633766908652935623681883409429299", 10).divide(BigInteger.nbv(1000));

			// delete and reinstantiate the whole window on teleport? that might be the best cleanup method...
//			xStart = new BigInteger("12234465498569413894406478743841145361827162748688159810039079514183939559218391664357372787631594358463168901374701809308891801671007230130066723378042125137212894594296124410621956639403190879922410562428365584417623555614966739717809626431260004568979968393974952774324960520703130399622609141713985447492509246633766908652935623681883409429299", 10);
//			yStart = new BigInteger("12234465498569413894406478743841145361827162748688159810039079514183939559218391664357372787631594358463168901374701809308891801671007230130066723378042125137212894594296124410621956639403190879922410562428365584417623555614966739717809626431260004568979968393974952774324960520703130399622609141713985447492509246633766908652935623681883409429299", 10);			
//			xStart = xStart.multiply(BigInteger.nbv(4));
//			yStart = yStart.multiply(BigInteger.nbv(4));
			
			selectedX = xStart.clone();
			selectedX = yStart.clone();

			// temp overlay
			addChild(overlay);

			// populate the window			
			fillView();
			manageView();
			centerOn(xStart, yStart);
			
			// apply mask
			windowMask.graphics.beginFill(0);
			windowMask.graphics.drawRect(0, 0, _width, _height);
			windowMask.graphics.endFill();
			this.mask = windowMask;


			this.addEventListener(MouseEvent.MOUSE_MOVE, onMouseMove);
		}
		
		
		private function onMouseMove(e:MouseEvent):void {
			if(e.buttonDown) {
				movePanes(e.stageX - lastMouseX, e.stageY - lastMouseY)
			}
			
			lastMouseX = e.stageX;
			lastMouseY = e.stageY;			
		}
		
		private function paneExists(xTest:int, yTest:int):Boolean {
			for (var i:int = 0; i < panes.length; i++) {
				if ((panes[i].x == xTest) && (panes[i].y == yTest)) {
					return true;
				}
			}
			return false;
		}
		
		// true if the pane is in view. TODO could be more conservative with this?
		private function inView(xTest:int, yTest:int):Boolean {
			if((xTest > xOffset - xOverdraw)
				&& (xTest < maxWidth + xOffset + xOverdraw)
				&& (yTest > yOffset - yOverdraw)
				&& (yTest < maxHeight + yOffset + yOverdraw)) {
				return true;
			}
			return false;
		}
		
		
		public function setScale(_x:Number, _y:Number):void {
			this.scaleX = _x;
			this.scaleY = _y;
			
			// this needs work, probably a table of values instead
			//this.xOverdraw = (2 / _x) * PANE_WIDTH;
			//this.yOverdraw = (2 / _y) * PANE_HEIGHT;
			
			
			this.x =  ((-maxWidth * _x) / 2) + (maxWidth / 2);
			this.y =  ((-maxHeight * _y) / 2) + (maxHeight / 2);
			
		}
		
		
		// TODO roll this into fillView()?
		// adds and removes children as appropriate
		private function manageView():void {
			
			for (var i:int = 0; i < panes.length; i++) {
				tempPane = panes[i];
				if (!inView(tempPane.x, tempPane.y) && this.contains(tempPane)) {
					// remove it from the drawing list if it's there
					this.removeChild(tempPane);
				}
				else if(inView(tempPane.x, tempPane.y) && !this.contains(tempPane)) {
					// add it
					this.addChild(tempPane);
				}
			}
		}
				
		// adds new panes to the visible area
		private function fillView():void {
			for (var i:int = xOffset - xOverdraw; i < maxWidth + xOffset + xOverdraw; i += PANE_WIDTH) {
				for (var j:int = yOffset - yOverdraw; j < maxHeight + yOffset + yOverdraw; j += PANE_HEIGHT) {
					// add panes as necessarry
					if (!paneExists(i, j)) {
						
						//make the first one the seed pane
						if(panes.length == 0) {
							trace("seeding");
							xTemp = xStart.clone();
							yTemp = yStart.clone();
							
							// TODO, make the most recent pane the seed pane, perpetually
							// just pass around a reference
						}
						else {
							// figure out distance from the start value, multiply it out by delta
							xTemp = xStart.add(xDelta.multiply(BigInteger.nbv(((i - panes[0].x) / PANE_WIDTH) * PANE_X_COUNT)));
							yTemp = yStart.add(yDelta.multiply(BigInteger.nbv(((j - panes[0].y) / PANE_HEIGHT) * PANE_Y_COUNT)));
							
							// check the bounds, don't draw past them
							if (xTemp.compareTo(BigInteger.ZERO) < 0) continue;
							if (yTemp.compareTo(BigInteger.ZERO) < 0) continue;
							if (xTemp.compareTo(X_MAX) > 0) continue;
							if (yTemp.compareTo(Y_MAX) > 0) continue;
						}						
						
						//trace("xTemp: " + xTemp.toString(10));
						//trace("add");
						tempPane = new Pane(this, i, j, xTemp, yTemp);
						panes.push(tempPane); // the main list
						renderQueue.push(tempPane); // stack of panes to be rendered... could use boolean flag?
						if(queueEmpty) renderPanes(); 
					}
				}
			}
			sortRenderQueue();
		}
		
		// this is kind of ugly
		private var queueEmpty:Boolean = true;
		
		private function onDoneRendering(e:Event):void {
			//trace("done rendering");
			// recurses back to the render panes function
			
			e.target.removeEventListener(Pane.DONE_RENDERING, onDoneRendering);
			renderPanes();
		}
		
		
		private function renderPanes():void {
			//trace(renderQueue);
			if(renderQueue.length > 0) {
	
				//trace("rendering first of " + renderQueue.length);
				queueEmpty = false; // different from array length! empty if nothing is in the queue AND nother is in the process of being rendered
				renderQueue[0].addEventListener(Pane.DONE_RENDERING, onDoneRendering);
				renderQueue.shift().renderCells(); // pop the first one and render it
				// render the first pane in the queue
			}
			else {
				overlay.graphics.clear();
				queueEmpty = true;
			}
		}
		
		// sorts the render queue based on distance from the center of the screen
		private function sortRenderQueue():void {
			overlay.graphics.clear();
			for(var i:int = 0; i < renderQueue.length; i++) {
				renderQueue[i].distance = Utilities.distance(windowCenter().x, windowCenter().y, renderQueue[i].x, renderQueue[i].y); 
				renderQueue.sort(compareDistance);
			
				// draw lines for debug
				overlay.graphics.lineStyle(1, 0xff0000);
				overlay.graphics.moveTo(windowCenter().x, windowCenter().y);
				overlay.graphics.lineTo(renderQueue[i].x, renderQueue[i].y);
			}
			
			
			//this.setChildIndex(overlay, this.numChildren - 1);
			
			
		}
		
		private function compareDistance(a:Pane, b:Pane ):Number {
			return a.distance - b.distance;
		}		
		
		private function movePanes(deltaX:int, deltaY:int):void {
			// track the offset
			xOffset += (deltaX);
			yOffset += (deltaY);

			xOffset %= PANE_WIDTH;
			yOffset %= PANE_HEIGHT;
			
			// track cell center changes
			xAccumulator += Math.abs(deltaX);
			yAccumulator += Math.abs(deltaY);
			

			for(var i:int = 0; i < panes.length; i++) {
				panes[i].x += deltaX;
				panes[i].y += deltaY;
			}
			
			// rebuild the visible area
			fillView();
			manageView();
			
			if(xAccumulator > CELL_WIDTH) {
				xAccumulator = 0;
				// fire event
				handleSelectionChange();
			}
			
			if (yAccumulator > CELL_HEIGHT) {
				yAccumulator = 0;
				// fire event
				handleSelectionChange();
			}				
			
			
		}
		
		public function setDelta(newDelta:BigInteger):void {
			trace("here: ");
			trace(newDelta.toString(10));
			// reset, remove all children

			// trash the panes and the render queue
			for(var i:int = 0; i < panes.length; i++) {
				panes[i].bitmapData.dispose();
				
				if (this.contains(panes[i])) {
					this.removeChild(panes[i]);
				}
			}	
			
			panes = new Vector.<Pane>();
			renderQueue = new Vector.<Pane>();
			
			// update the delta
			xDelta = newDelta;
			yDelta = newDelta;
	
			xStart = selectedX;
			yStart = selectedY;
			
			// rebuild the view
			fillView();
			manageView();
			centerOn(selectedX, selectedY);
		}
		
		
		
		private function handleSelectionChange():void {
			// make the updates
			var objects:Array = getObjectsUnderPoint(windowCenter())
			tempPane = null;
			for (var i:int = 0; i < objects.length; i++) {
				tempPane = objects[i] as Pane;
				
				if(tempPane != null) {
					// compensate for the pane offset
					//trace("updating selected");
					var xCell:int = Math.floor((windowCenter().x - tempPane.x) / CELL_WIDTH);
					var yCell:int = Math.floor((windowCenter().y - tempPane.y) / CELL_HEIGHT);
//					trace(xCell + " " + yCell)
//					trace(tempPane.xPos.toString(10));
//					trace(tempPane.yPos.toString(10));
					
					selectedX = tempPane.xPos.add(xDelta.multiply(BigInteger.nbv(xCell)));
					selectedY = tempPane.yPos.add(yDelta.multiply(BigInteger.nbv(yCell)));
				}
			}
			
			// make it known
			dispatchEvent(new Event(Window.SELECTION_CHANGE));
		}
		
		public function centerOn(xCenter:BigInteger, yCenter:BigInteger):void {
			// see if it's in the list
			var foundLocal:Boolean = false;
			trace("Centering on: " + xCenter.toString(10) + " " + yCenter.toString(10));
			
			for (var i:int = 0; i < panes.length; i++) {
				//trace("Pane: " + panes[i].xPos.toString(10) + " " + panes[i].yPos.toString(10));
				
				if ((xCenter.compareTo(panes[i].xPos) >= 0) &&
						(xCenter.compareTo(panes[i].xPosMax) <= 0) &&
						(yCenter.compareTo(panes[i].yPos) >= 0) &&
						(yCenter.compareTo(panes[i].yPosMax) <= 0)){
						trace("ping");
						foundLocal = true;

						// correct for cell offset
						var xCell:int = xCenter.subtract(panes[i].xPos).intValue();
						var yCell:int = yCenter.subtract(panes[i].yPos).intValue();
						
						var xMove:int = (windowCenter().x - panes[i].x - (xCell * CELL_WIDTH)) - CELL_WIDTH / 2;
						var yMove:int = (windowCenter().y - panes[i].y - (yCell * CELL_HEIGHT)) - CELL_WIDTH / 2 ;
						
						// move
						movePanes(xMove, yMove);
						
						break;						
				}
			}
			
			// if we get here, we need to warp, easier just to recreate the whole thing?
			if(!foundLocal) {
				trace("gotta warp");
				
				// tk warp animation!
				// reset, remove all children
				while(this.numChildren > 0) {
					this.removeChildAt(0);
				}
				
				// trash the panes
				panes = new Vector.<Pane>();
				
				selectedX = xCenter;
				selectedY = yCenter;

				xStart = selectedX;
				yStart = selectedY;
				
				// rebuild the view
				fillView();
				manageView();
				centerOn(selectedX, selectedY);				
			}
			
			// TODO what about moving > 2^32?
		}
		
		
		
		public function windowCenter():Point {
			return new Point(maxWidth / 2, maxHeight / 2);
		}
		
		// the whole number, no x and y business
		public function getSelectedIndex():BigInteger {
			return new BigInteger(Utilities.zeroPad(selectedX.toString(2), this.X_PIXEL_COUNT) + Utilities.zeroPad(selectedY.toString(2), this.Y_PIXEL_COUNT), 2);
		}
		
		
		
		
		// TODO maybe depricated thanks to more efficient event approach
		public function getCurrentX():BigInteger {
			return getPosUnderPointX(windowCenter());
		}
		
		public function getPosUnderPointX(p:Point):BigInteger {
			var objects:Array = getObjectsUnderPoint(windowCenter())
			
			for (var i:int = 0; i < objects.length; i++) {
				tempPane = objects[i] as Pane;
				
				if(tempPane != null) {
					// compensate for the pane offset
					var xCell:int = Math.floor((windowCenter().x - tempPane.x) / CELL_WIDTH);
					return tempPane.xPos.add(xDelta.multiply(BigInteger.nbv(xCell)));
				}
			}
			
			// didn't find it, relent
			return BigInteger.nbv(0);
		}
			
		public function getCurrentY():BigInteger {
			return getPosUnderPointY(windowCenter());
		}
		
		public function getPosUnderPointY(p:Point):BigInteger {
			var objects:Array = getObjectsUnderPoint(windowCenter())
			
			for (var i:int = 0; i < objects.length; i++) {
				tempPane = objects[i] as Pane;
				
				if(tempPane != null) {
					// compensate for the pane offset
					var yCell:int = Math.floor((windowCenter().y - tempPane.y) / CELL_HEIGHT);
					return tempPane.yPos.add(yDelta.multiply(BigInteger.nbv(yCell)));
				}
			}
			
			// didn't find it, relent
			return BigInteger.nbv(0);
		}		

		
		
		
	}
}