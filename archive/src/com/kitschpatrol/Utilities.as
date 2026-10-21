package com.kitschpatrol
{
	public class Utilities extends Object
	{
		public function Utilities()
		{
			super();
		}
		
		public static function zeroPad(number:String, width:int):String {
			var ret:String = ""+ number;
			while( ret.length < width )
				ret="0" + ret;
			return ret;
		}
		
		public static function randRange(minNum:int, maxNum:int):int	{
			return (Math.floor(Math.random() * (maxNum - minNum + 1)) + minNum);
		}
		
		public static function arrayShuffle(arr:Array):Array {
			var arr2:Array = [];
			while (arr.length > 0) {
				arr2.push(arr.splice(Math.round(Math.random() * (arr.length - 1)), 1)[0]);
			}
			return arr2;
		}
		
		
		public static function distance(x1:int, y1:int, x2:int, y2:int):Number {
			return Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
		}

		
		public static function map(value:Number, istart:Number, istop:Number, ostart:Number, ostop:Number):Number {
			return ostart + (ostop - ostart) * ((value - istart) / (istop - istart));
		}
		
		public static function rgbToHex(r:uint, g:uint, b:uint):uint{
			var hex:uint = (r << 16 | g << 8 | b);
			return hex;
		}

		public static function formatNumber(numString:String):String	{
			        var result:String = ''
			
			        while (numString.length > 3)
			        {
				                var chunk:String = numString.substr(-3)
				                numString = numString.substr(0, numString.length - 3)
				                result = ',' + chunk + result
			        }
			
			        if (numString.length > 0)
			        {
				                result = numString + result
			        }
			
			        return result
		}
		
		
	}
	
}