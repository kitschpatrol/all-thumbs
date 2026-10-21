package com.kitschpatrol
{
	import flash.display.Sprite;
	import flash.events.MouseEvent;
	import flash.text.AntiAliasType;
	import flash.text.Font;
	import flash.text.FontStyle;
	import flash.text.TextField;
	import flash.text.TextFieldAutoSize;
	import flash.text.TextFieldType;
	import flash.text.TextFormat;
	import flash.text.TextFormatAlign;
		
	
	public class NavHolder extends Sprite
	{
		private var panes:Array = [];
		private var tabs:Array = [];
		private var labels:Array = [];
		
		public function NavHolder(_w:int, _h:int) {
			super();
			
			this.graphics.beginFill(0x4a525a, .95);
			this.graphics.drawRoundRectComplex(0, 25, _w, _h, 0, 5, 5, 5);
			this.graphics.endFill();
			
		}
		
		public function addPane(navPane:NavPane):void {
			// add the tab
			panes.push(navPane);
			

			
			var tempTab:Sprite = new Sprite();
			tabs.push(tempTab);
			this.addChild(tempTab);
			tempTab.addEventListener(MouseEvent.CLICK, onTabClick);
			tempTab.alpha = .5;
			
			// only add the first one
			if(panes.length == 1) {
				trace("adding first");
				addChild(navPane);
				tempTab.alpha = 1;
			}
			
			drawTabs();
		}
		
		private function onTabClick(e:MouseEvent):void {
			trace(e.target.name);
			var tabIndex:int = e.target.name;
			
			// deactivate the others
			for(var i:int = 0; i < panes.length; i++) {
				if(this.contains(panes[i])) {
					tabs[i].alpha = 0.5;
					this.removeChild(panes[i]);
				}
			}
			
			
			
			// activate the new one
			tabs[tabIndex].alpha = 1;
			this.addChild(panes[tabIndex]);
		}
		
		private function drawTabs():void {
			for(var i:int = 0; i < panes.length; i++) {
				trace(panes[i].tabTitle);
				
				tabs[i].name = i;
				tabs[i].graphics.beginFill(0x4a525a, .95);
				tabs[i].graphics.drawRoundRectComplex(0, 0, 75, 25, 5, 5, 0, 0);
				tabs[i].graphics.endFill();
				
				tabs[i].x = i * 80;
				
				
				labels[i] = new TextField();
				var format:TextFormat = new TextFormat();
				format.size = 14;
				format.align = TextFormatAlign.LEFT;
				
				 format.font = "Helvetica";
				 format.bold = true;
				 format.color = 0xffffff;
				 
				 labels[i].type = TextFieldType.DYNAMIC;
				 labels[i].text = panes[i].tabTitle;
				 labels[i].setTextFormat(format);
				 labels[i].selectable = false;
				 labels[i].mouseEnabled = false;
				 
				 
				 labels[i].x = 5;
				 labels[i].y = 5;
				 
				 tabs[i].addChild(labels[i]);				 
				 
			}
			
		}
	}
}