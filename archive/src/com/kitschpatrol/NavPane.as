package com.kitschpatrol
{
	import flash.display.Sprite;
	
	public class NavPane extends Sprite
	{
		public var tabTitle:String;
		public var tabHitZone:Sprite = new Sprite();
		
		public function NavPane(_tabTitle:String)
		{
			super();
			tabTitle = _tabTitle;
		}
	}
}