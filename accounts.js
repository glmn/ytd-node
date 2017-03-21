var sqlite = require('sqlite3').verbose();
module.exports = class Accounts {

	constructor()
	{
		this.db = new sqlite.Database('accounts.db', sqlite.OPEN_READWRITE);
		this.currentIndex = 0
		this.current = {}
	}

	fetchAll()
	{
		return new Promise((resolve,reject) => {
			this.db.all('SELECT * FROM accounts', (err, rows) => {
				if(err) reject(err)
				resolve(rows)
			})
		})
	}

	count()
	{
		return this.list.length;
	}

	showList()
	{
		debug.log(this.list);
	}
	
	select(index)
	{
		return new Promise((resolve,reject) => {
			if(this.count == 0) reject(new Error('Zero accounts in database'))
			if(this.count-1 > index) reject(new Error('Account index out of range'))

			this.currentIndex = index;
			this.current = this.list[index];
			resolve()
		})
	}

	selectFirst()
	{
		return this.select(0);
	}

	next()
	{
		retrun this.select(this.currentIndex+1);
	}

	nextExists()
	{
		return this.count-1 >= this.currentIndex+1;
	}
}