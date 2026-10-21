package com.kitschpatrol {
	
	import com.hurlant.math.BigInteger;
	
	import flash.display.Bitmap;
	import flash.display.BitmapData;
	import flash.events.Event;
	import flash.geom.Rectangle;
	import flash.utils.ByteArray;
	import flash.utils.getTimer;
	
	public class Pane extends Bitmap	{		
		static public var DONE_RENDERING:String = "done rendering"; // fires when the "center" cell changes		
		
		public var xPos:BigInteger;
		public var yPos:BigInteger;
		public var xPosMax:BigInteger; // the right most value
		public var yPosMax:BigInteger; // the bottom most value, yPos + height, kind of
		public var yPosScratch:BigInteger;	
		public var xPosScratch:BigInteger;
		private var window:Window;
		private var xBytes:ByteArray;
		private var yBytes:ByteArray;
		private var pixelBytes:ByteArray;
		private var copyRect:Rectangle;
		private var xOffset:int = 0;
		private var yOffset:int = 0;
		
		private var xBoundCount:int = -1;
		private var yBoundCount:int = -1;
		
		// sort render queue based on distance
		public var distance:Number = 0; // start as far away as possible so it won't get sorted to the front
		
		public var isRendered:Boolean = false;
		
		
		// performance timers
		private var paneStart:int;
		private var cellStart:int;
		
		
		public function Pane(_window:Window, _x:int, _y:int, _xPos:BigInteger, _yPos:BigInteger) {
			super();

			window = _window;
			x = _x;
			y = _y;
			xPos = _xPos;
			yPos = _yPos;
			
			xPosMax = xPos.add(window.xDelta.multiply(BigInteger.nbv(window.PANE_X_COUNT)));
			yPosMax = yPos.add(window.yDelta.multiply(BigInteger.nbv(window.PANE_Y_COUNT)));
			
			bitmapData = new BitmapData(window.PANE_WIDTH, window.PANE_HEIGHT, false, 0x4a525a);
			copyRect = new Rectangle(0, 0, window.X_RES, window.Y_RES / 2);

			xPosScratch = xPos.clone();
			yPosScratch = yPos.clone();
		}
		
		public function renderCells():void {
			// start timer for whole pane
			paneStart = getTimer();
			
			// draw all the Xs
			// should combine y too?
			for(var i:int = 0; i < window.PANE_X_COUNT; i++) {
				// calculate value for this row
				pixelBytes = new ByteArray();
				pixelBytes.length = window.X_BYTE_COUNT;
				//trace(window.X_BYTE_COUNT);
				xBytes = xPosScratch.toPixels();
				xBytes.position = 0;
				xOffset = window.X_BYTE_COUNT - xBytes.bytesAvailable;
				pixelBytes.position = xOffset;
				pixelBytes.writeBytes(xBytes);				

				for(var j:int = 0; j < window.PANE_Y_COUNT; j++) {
					// copy over all of the columns
					pixelBytes.position = 0;
					this.bitmapData.setPixels(copyRect, pixelBytes);
					copyRect.y += window.CELL_HEIGHT;
				}	
				
				copyRect.x += window.CELL_WIDTH;
				copyRect.y = 0;
				
				xPosScratch = xPosScratch.add(window.xDelta);
				
				// check x bounds (would be faster to go right left...)
				if ((xPosScratch.compareTo(BigInteger.ZERO) < 0) ||
					  (xPosScratch.compareTo(window.X_MAX) > 0)) {
						trace("out of bounds");
						xBoundCount = i;
						break;
				}
								
				
			}
			
			
			copyRect = new Rectangle(0, 24, 48, 24);
			// draw all the ys
			for(var k:int = 0; k < window.PANE_Y_COUNT; k++) {
				// calculate value for this row
				pixelBytes.clear();
				pixelBytes.length = window.Y_BYTE_COUNT;
				//trace(window.X_BYTE_COUNT);
				yBytes = yPosScratch.toPixels();
				yBytes.position = 0;
				yOffset = window.Y_BYTE_COUNT - yBytes.bytesAvailable;
				pixelBytes.position = yOffset;
				pixelBytes.writeBytes(yBytes);				
				
				for(var m:int = 0; m < window.PANE_Y_COUNT; m++) {
					// copy over all of the columns
					pixelBytes.position = 0;
					this.bitmapData.setPixels(copyRect, pixelBytes);
					copyRect.x += window.CELL_WIDTH;
				}
				
				copyRect.y += window.CELL_HEIGHT;
				copyRect.x = 0;
				
				
				yPosScratch = yPosScratch.add(window.yDelta);
				
				if ((yPosScratch.compareTo(BigInteger.ZERO) < 0) ||
					(yPosScratch.compareTo(window.Y_MAX) > 0)) {
					trace("out of Y bounds");
					yBoundCount = k;
					break;
				}
				

			}
			
			// draw over if we overdrew
			// this is pretty crude...
			if(yBoundCount > -1) {
				this.bitmapData.fillRect(new Rectangle((yBoundCount) * window.CELL_WIDTH,
																							window.CELL_HEIGHT,
																							 window.CELL_WIDTH * (window.PANE_X_COUNT - yBoundCount),
																						   window.CELL_HEIGHT * window.PANE_Y_COUNT), 0x4a525a); 
			}
			
			if(xBoundCount > -1) {
				this.bitmapData.fillRect(new Rectangle(window.CELL_WIDTH,
					                                     (xBoundCount) * window.CELL_HEIGHT,
																							 window.CELL_WIDTH * window.PANE_X_COUNT,
																								window.CELL_HEIGHT * (window.PANE_Y_COUNT - xBoundCount)
																								), 0x4a525a); 
			}						
			
			
			
			//trace("Pane Rendered in: " + (getTimer() - paneStart));
			isRendered = true; // flag ourselves
			this.dispatchEvent(new Event(Pane.DONE_RENDERING)); // announce ourselves			
		}
		
		

		
		

		
	}
}