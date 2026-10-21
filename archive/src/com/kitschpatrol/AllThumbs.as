package com.kitschpatrol {
	import com.bit101.components.CheckBox;
	import com.bit101.components.HUISlider;
	import com.bit101.components.Label;
	import com.bit101.components.PushButton;
	import com.bit101.components.Text;
	import com.bit101.components.VSlider;
	import com.hurlant.crypto.symmetric.NullPad;
	import com.hurlant.math.BigInteger;
	
	import flash.display.Bitmap;
	import flash.display.BitmapData;
	import flash.display.Shape;
	import flash.display.Sprite;
	import flash.display.StageDisplayState;
	import flash.display.StageQuality;
	import flash.display.StageScaleMode;
	import flash.events.ActivityEvent;
	import flash.events.ContextMenuEvent;
	import flash.events.Event;
	import flash.events.TimerEvent;
	import flash.geom.Point;
	import flash.geom.Rectangle;
	import flash.media.Camera;
	import flash.media.Video;
	import flash.ui.ContextMenu;
	import flash.ui.ContextMenuItem;
	import flash.ui.Mouse;
	import flash.ui.MouseCursor;
	import flash.ui.MouseCursorData;
	import flash.utils.ByteArray;
	import flash.utils.Timer;
	import flash.utils.getTimer;
	
	// note modifications to big integer
	
	[SWF(width="1680", height="1050", backgroundColor="0x2f3439", frameRate="30")]	
	
	public class AllThumbs extends Sprite	{

		// navigation window
		private var window:Window;
		private var deltaSlider:HUISlider;
		private var locationText:Text;
		private var submitTextButton:PushButton;
		private var submitCameraButton:PushButton;
		private var textLabel:Label;
		private var thresholdSlider:VSlider;
		private var controlPanel:Sprite		
		private var zoomSlider:HUISlider;
		private var startButton:PushButton;
		private var endButton:PushButton;
		
		
		private var video:Video;
		private var camera:Camera;
		private var cameraBitmap:Bitmap;
		private var processedCameraBitmap:Bitmap;
		private var cameraRect:Rectangle;
		private var cameraBytes:ByteArray;
		private var cameraPixelStringX:String;
		private var cameraPixelStringY:String;
		private var thresholdValue:Number;
		
		private var shutterTimer:Timer;
		
		private var autoShutterToggle:CheckBox;
		
		private var cursorData:MouseCursorData;
		
		// New navigation
		private var viewHolder:NavHolder;
		private var navHolder:NavHolder;
		
		public function AllThumbs() {
			//toggleFullScreen();
			
			// Build the window
			window = new Window(0, 0, 1680, 885);
			addChild(window);
			
			// Build the gui
			controlPanel = new Sprite();
			controlPanel.graphics.beginFill(0x000000);
			controlPanel.graphics.drawRect(0, 0, 1680, 165);
			controlPanel.graphics.endFill();
			controlPanel.x = 0;
			controlPanel.y = 885;			
			addChild(controlPanel);
			
			// the mini map
			var mapLabel:Label = new Label(controlPanel, 15, 10, "POSSIBILITY MAP");
			var miniMap:MiniMap = new MiniMap(120, 120, window);
			miniMap.x = 15;
			miniMap.y = 30;
			controlPanel.addChild(miniMap);
				
			// the camera
			var cameraLabel:Label = new Label(controlPanel, 15 + 120 + 15, 10, "CAMERA FEED");			

			camera = Camera.getCamera();
			camera.setMode(64, 48, 30);
			video = new Video(64, 48);
			video.attachCamera(camera);
			video.addEventListener(Event.ENTER_FRAME, onCameraUpdate);
			
			cameraRect = new Rectangle(0, 0, 48, 48);
			cameraBitmap = new Bitmap(new BitmapData(48, 48, false, 0));
			processedCameraBitmap = new Bitmap(new BitmapData(48, 48, false, 0xffffff));
			processedCameraBitmap.x = 15 + 120 + 15;
			processedCameraBitmap.y = 30;
			processedCameraBitmap.scaleX = 2.5;
			processedCameraBitmap.scaleY = 2.5;
			controlPanel.addChild(processedCameraBitmap);
			
			
			shutterTimer = new Timer(1000);
			shutterTimer.addEventListener(TimerEvent.TIMER, onSubmitCamera);
			shutterTimer.start(); // automatic from the start
			
			// the camera submit button
			submitCameraButton = new PushButton(controlPanel, 50, 170, "GO", onSubmitCamera);
			submitCameraButton._label._tf.textColor = 0x0;
			submitCameraButton.width = 120;
			
			// Text Pane
			textLabel = new Label(controlPanel, 15 + 120 + 15 + 120 + 15 , 10, "POSSIBILITY NUMBER");
			
			locationText = new Text(controlPanel, 15 + 120 + 15 + 120 + 15, 25	, "0");
			locationText.width = 1370;
			locationText.height = 130;			
			
			window.addEventListener(Window.SELECTION_CHANGE, onSelectionChange);			
			
			
			
			
			// eric's private gui
			
			
			autoShutterToggle = new CheckBox(controlPanel, 10, -105, "Auto Shutter", onAutoShutterToggle);
			autoShutterToggle.selected = false;
			
			// the delta slider, toggles
			deltaSlider = new HUISlider(controlPanel, 10, -30, "Delta", onDeltaSlide);
			deltaSlider.minimum = 1;
			deltaSlider.width = 340;
			deltaSlider.maximum = 346;
			deltaSlider.labelPrecision = 0;
			deltaSlider.height = 20;
			
			// the zoom slider
			zoomSlider = new HUISlider(controlPanel, 10, -50, "Zoom", onZoomSlide); 
			zoomSlider.minimum = 1;
			zoomSlider.width = 340;
			zoomSlider.maximum = 5;
			zoomSlider.tick = .1;
			
			// the start button
			startButton = new PushButton(controlPanel, 10, -90, "Start", onStartButton);
			startButton._label._tf.textColor = 0x0;		
			
			endButton = new PushButton(controlPanel, 120, -90, "End", onEndButton);
			endButton._label._tf.textColor = 0x0;		
			
			// camera slider, toggles
			thresholdValue = 0xffffff / 2;
			thresholdSlider = new VSlider(controlPanel, 15 + 120 + 15 + 120, 30, onThresholdSlide);
			thresholdSlider.minimum = 0;
			thresholdSlider.maximum = 0xffffff;
			thresholdSlider.value = thresholdValue;
			thresholdSlider.height = 120;
						
			
			
			
			
			// set up a full screen option in the context menu
			var myContextMenu:ContextMenu = new ContextMenu();
			var item:ContextMenuItem = new ContextMenuItem("Toggle Full Screen");
			myContextMenu.customItems.push(item);
			item.addEventListener(ContextMenuEvent.MENU_ITEM_SELECT, onFullScreenContextMenuSelect);
			contextMenu = myContextMenu;
			
			
			
			
			// set up a knobs and dials toggle in context menu
			var item2:ContextMenuItem = new ContextMenuItem("Toggle Knobs and Dials");
			myContextMenu.customItems.push(item2);
			item2.addEventListener(ContextMenuEvent.MENU_ITEM_SELECT, toggleKnobsAndDials);
			contextMenu = myContextMenu;			

			
			
			
			
			// set up the stage
			stage.scaleMode = StageScaleMode.NO_SCALE;
			stage.quality = StageQuality.HIGH;

			// the crosshairs
			var crosshairs:Shape = new Shape();
			crosshairs.graphics.lineStyle(1, 0xff0000);
			crosshairs.graphics.drawRect(0, 0, window.X_RES + 3, window.Y_RES + 3);
			crosshairs.x = Math.round(window.windowCenter().x - window.X_RES / 2) - 5;
			crosshairs.y = Math.round(window.windowCenter().y - window.X_RES / 2) - 5;
			addChild(crosshairs);

			
			// Mouse Hiding
			// This is ridiculous
			cursorData = new MouseCursorData();
			var cursorBitmaps:Vector.<BitmapData> = new Vector.<BitmapData>(1, true);
			cursorBitmaps[0] = new BitmapData(1, 1, true, 0x000000ff);
			cursorData.data = cursorBitmaps;
			Mouse.registerCursor("hidden", cursorData);			
			
			
			// start with mouse and dials hidden
			toggleFullScreen();
			toggleKnobsAndDials(new ContextMenuEvent(ContextMenuEvent.MENU_SELECT));
			
		}
		
		private function onZoomSlide(e:Event):void {
			window.setScale(e.target.value, e.target.value);
		}
		
		private function onStartButton(e:Event):void {
			window.centerOn(BigInteger.ZERO, BigInteger.ZERO);
		}
		
		private function onEndButton(e:Event):void {
			window.centerOn(window.X_MAX, window.Y_MAX);
		}		
		
		private function onCameraUpdate(e:Event):void {
			cameraBitmap.bitmapData.draw(video);
			var pt:Point = new Point(0, 0);
			
			
			var color:uint = 0xff0000;
			var maskColor:uint = 0xffffff;
			processedCameraBitmap.bitmapData = new BitmapData(48, 48, false, 0xffffff);
			processedCameraBitmap.bitmapData.threshold(cameraBitmap.bitmapData, cameraRect, pt, "<", thresholdValue, color, maskColor, false);
			
		}
		
		private function onThresholdSlide(e:Event):void {
			thresholdValue = thresholdSlider.value;
		}
		
		private function onSelectionChange(e:Event):void {

			//locationText.text = Utilities.formatNumber(window.getSelectedIndex().toString(10)) + "\n/\n3,742,053,650,892,133,432,367,999,773,538,322,459,225,928,823,527,575,869,347,258,443,714,776,254,479,140,165,467,924,450,143,929,014,376,701,328,043,796,892,084,250,680,644,651,644,268,919,891,406,030,558,009,514,559,848,402,392,186,697,349,032,657,288,467,726,728,117,428,485,865,736,692,545,611,669,179,323,917,560,467,904,459,270,003,565,249,200,768,855,069,969,069,462,910,188,335,948,939,853,235,385,655,600,614,050,799,627,402,904,169,955,617,680,686,939,217,306,230,732,743,306,013,312,855,692,685,442,723,231,659,949,822,010,462,888,578,091,073,832,552,856,131,420,378,840,703,853,686,445,535,243,055,462,767,679,945,780,563,431,553,986,820,134,725,467,051,353,840,270,015,201,262,955,847,832,589,866,641,019,681,571,016,376,279,703,475,133,297,517,542,073,557,917,754,709,550,486,937,454,822,846,451,632,280,550,418,910,946,262,563,991,699,255,138,480,187,856,382,366,661,603,621,981,981,643,212,128,456,085,078,016";
			locationText.text = Utilities.formatNumber(window.getSelectedIndex().toString(10));
			
		}
		
		private function onAutoShutterToggle(e:Event):void {
			if(shutterTimer.running) {
				shutterTimer.stop();
			}
			else {
				shutterTimer.start();
			}
			
			
		}
		

		
		private function onSubmitCamera(e:Event):void {
			
			cameraPixelStringX = "";
			cameraPixelStringY = "";
			cameraBytes = processedCameraBitmap.bitmapData.getPixels(cameraRect);
			cameraBytes.position = 0;
			var totalBytes:int = cameraBytes.bytesAvailable; 
			
			while(cameraBytes.bytesAvailable > (totalBytes / 2)) {
				if(cameraBytes.readUnsignedInt() == 0) {
					cameraPixelStringX += "0";
				}
				else {
					cameraPixelStringX += "1";
				}
			}
			
			// finish it off
			while(cameraBytes.bytesAvailable) {
				if(cameraBytes.readUnsignedInt() == 0) {
					cameraPixelStringY += "0";
				}
				else {
					cameraPixelStringY += "1";
				}
			}			
			
			
			window.centerOn(new BigInteger(cameraPixelStringX, 2), new BigInteger(cameraPixelStringY, 2));
			
		}
		
		private function onSubmitText(e:Event):void {
			
			trace("text submit");
			
			// center on the new location
			var target:BigInteger = new BigInteger(locationText.text, 10);
			var targetString:String = Utilities.zeroPad(target.toString(2), window.X_RES * window.Y_RES);
			var xString:String = (targetString.substr(0, targetString.length / 2));
			var yString:String = (targetString.substr(targetString.length / 2, targetString.length -1));
			
			trace(new BigInteger(xString, 2).toString(10));
			trace(new BigInteger(yString, 2).toString(10));
			
			window.centerOn(new BigInteger(xString, 2), new BigInteger(yString, 2));
	
		}
		
		private var fiveSteps:BigInteger = new BigInteger("12234465498569413894406478743841145361827162748688159810039079514183939559218391664357372787631594358463168901374701809308891801671007230130066723378042125137212894594296124410621956639403190879922410562428365584417623555614966739717809626431260004568979968393974952774324960520703130399622609141713985447492509246633766908652935623681883409429299", 10);
		private var lastDelataSlideValue:int = 1;
		
		
		public function toggleKnobsAndDials(e:ContextMenuEvent):void {
			trace("toggling knobs and dials");
			
			if (controlPanel.contains(thresholdSlider)) {
				controlPanel.removeChild(thresholdSlider);
				controlPanel.removeChild(deltaSlider);
				controlPanel.removeChild(zoomSlider);
				controlPanel.removeChild(startButton);
				controlPanel.removeChild(endButton);
				controlPanel.removeChild(autoShutterToggle);
			}
			else {
				controlPanel.addChild(thresholdSlider);
				controlPanel.addChild(deltaSlider);
				controlPanel.addChild(zoomSlider);
				controlPanel.addChild(startButton);
				controlPanel.addChild(endButton);
				controlPanel.addChild(autoShutterToggle);
			}
			
			
		}
		
		public function onDeltaSlide(e:Event):void {
			
			if(lastDelataSlideValue != deltaSlider.value) {
			trace("New Delta: " + deltaSlider.value.toString());
			
			// special case for the end
			if(deltaSlider.value == 346) {
				trace("five steps");
				window.setDelta(fiveSteps);
			}
			else if(deltaSlider.value == 1) {
				window.setDelta(BigInteger.ONE);
			}
			else {
				window.setDelta(BigInteger.TEN.pow(deltaSlider.value));
			}
			
			}
			
			lastDelataSlideValue = deltaSlider.value;
			//window.setDelta(fiveSteps);
		}
		
		
		
		
		
		
		
		private function onFullScreenContextMenuSelect(e:Event):void {
			toggleFullScreen();
		}
		
		
		
		
		
		private function toggleFullScreen():void {
			if (stage.displayState == StageDisplayState.NORMAL) {
				Mouse.cursor = "hidden";
				stage.displayState = StageDisplayState.FULL_SCREEN;
			}
			else {
				Mouse.cursor = MouseCursor.ARROW;
				stage.displayState = StageDisplayState.NORMAL;
			}
		}


	}	
}