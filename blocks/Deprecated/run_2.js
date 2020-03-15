const Classes = require("../../src/classes");

var block = new Classes.Block(__dirname);
block.type = "run_2";
block.message0 = "run %1 and save output to variable %2";
block.args0 = [
  new Classes.ArgValue("NAME", undefined, "RIGHT"),
  new Classes.ArgVariable("var", null),
];
block.inputsInline = false;
block.previousStatement = null;
block.nextStatement = null;
block.colour = 330;
block.deprecated = true;

module.exports = block;